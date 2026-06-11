from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Literal, Any, List, Dict
from uuid import UUID
from datetime import datetime
from zoneinfo import ZoneInfo
from io import BytesIO

import re
import markdown
import requests

from .db import supabase
from .notification_service import send_clinical_report
from .pdf_service import generate_report_pdf, generate_mc_pdf

router = APIRouter(prefix="/screenings", tags=["screenings"])

# ---------------------------
# Models
# ---------------------------
# IMPORTANT: only enum values available in DB are: approved, overridden
DoctorDecision = Literal["approved", "overridden"]


class ScreeningCreate(BaseModel):
    patient_id: str
    created_by: Optional[str] = None  # staff user id (nurse)


class AssignDoctorRequest(BaseModel):
    screening_session_id: str
    doctor_id: str


class DoctorReviewRequest(BaseModel):
    doctor_id: str
    decision: DoctorDecision

    # Optional fields (based on your doctor_reviews table)
    final_grade_left: Optional[str] = None
    final_grade_right: Optional[str] = None
    override_reason: Optional[str] = None
    report_url: Optional[str] = None


# ---------------------------
# Constants
# ---------------------------
LOCKED_STATUSES = {"approved", "overridden"}
DELETABLE_STATUS = "pending"

UPLOADS_TABLE = "retinal_images"
UPLOADS_FK_COL = "screening_session_id"


def _norm_status(v: Optional[str]) -> str:
    return (v or "").lower().strip()


def _first(rows):
    return rows[0] if rows else None


# ---------------------------
# List screenings by patient
# ---------------------------
@router.get("/by-patient/{patient_id}")
def list_screenings_by_patient(patient_id: UUID):
    try:
        res = (
            supabase.table("screening_sessions")
            .select("*")
            .eq("patient_id", str(patient_id))
            .order("session_date", desc=True)
            .execute()
        )
        return {"ok": True, "data": res.data or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------
# Create screening session
# ---------------------------
@router.post("/create")
def create_screening(payload: ScreeningCreate):
    try:
        existing = (
            supabase.table("screening_sessions")
            .select("session_number")
            .eq("patient_id", payload.patient_id)
            .order("session_number", desc=True)
            .limit(1)
            .execute()
        )

        last_no = existing.data[0]["session_number"] if existing.data else 0
        next_no = last_no + 1

        insert_data = {
            "patient_id": payload.patient_id,
            "session_number": next_no,
            "status": "pending",
        }

        if payload.created_by:
            insert_data["created_by"] = payload.created_by

        res = supabase.table("screening_sessions").insert(insert_data).execute()
        created = (res.data or [None])[0]

        return {"ok": True, "data": created}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------
# Assign / Reassign Doctor
# ---------------------------
@router.post("/assign-doctor")
def assign_doctor(payload: AssignDoctorRequest):
    try:
        sid = payload.screening_session_id
        doctor_id = payload.doctor_id

        # 1) Fetch session
        res = (
            supabase.table("screening_sessions")
            .select("*")
            .eq("id", sid)
            .single()
            .execute()
        )

        session = res.data
        if not session:
            raise HTTPException(status_code=404, detail="Screening session not found")

        status = _norm_status(session.get("status"))

        # 2) Block if locked (already reviewed)
        if status in LOCKED_STATUSES:
            raise HTTPException(
                status_code=403,
                detail=f"Session is locked (status={status}). Cannot assign or reassign doctor.",
            )

        # 3) Update assignment
        update_data = {"assigned_doctor_id": doctor_id, "status": "assigned"}

        upd = (
            supabase.table("screening_sessions")
            .update(update_data)
            .eq("id", sid)
            .execute()
        )

        return {"ok": True, "data": upd.data}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Doctor Inbox (ENRICHED via FK joins)
# GET /screenings/assigned-to/{doctor_id}
# ============================================================
@router.get("/assigned-to/{doctor_id}")
def list_assigned_to_doctor(doctor_id: UUID):
    try:
        res = (
            supabase.table("screening_sessions")
            .select("id, patient_id, session_number, session_date, status, created_by")
            .eq("assigned_doctor_id", str(doctor_id))
            .order("session_date", desc=True)
            .execute()
        )

        rows = res.data or []
        if not rows:
            return {"ok": True, "data": []}

        # Collect unique IDs for batch lookups
        patient_ids = list({r["patient_id"] for r in rows if r.get("patient_id")})
        staff_ids = list({r["created_by"] for r in rows if r.get("created_by")})

        # Batch fetch patient names
        patient_map = {}
        if patient_ids:
            p_res = supabase.table("patients").select("id, name").in_("id", patient_ids).execute()
            patient_map = {p["id"]: p["name"] for p in (p_res.data or [])}

        # Batch fetch nurse names
        staff_map = {}
        if staff_ids:
            s_res = supabase.table("staff_users").select("id, name").in_("id", staff_ids).execute()
            staff_map = {s["id"]: s["name"] for s in (s_res.data or [])}

        out = []
        for r in rows:
            out.append({
                "id": r.get("id"),
                "patient_id": r.get("patient_id"),
                "session_number": r.get("session_number"),
                "session_date": r.get("session_date"),
                "status": r.get("status"),
                "created_by": r.get("created_by"),
                "patient_name": patient_map.get(r.get("patient_id")),
                "assigned_by_name": staff_map.get(r.get("created_by")),
            })

        return {"ok": True, "data": out}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================
# Needed for doctors_review page
# GET /screenings/{screening_id}
# ============================================================
@router.get("/{screening_id}")
def get_screening_by_id(screening_id: UUID):
    try:
        res = (
            supabase.table("screening_sessions")
            .select("*, patients:patient_id ( id, name, email )")
            .eq("id", str(screening_id))
            .single()
            .execute()
        )
        if not res.data:
            raise HTTPException(status_code=404, detail="Screening session not found")
        return {"ok": True, "data": res.data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# NEW: Get latest doctor review (for Final Verdict display)
# GET /screenings/{screening_id}/doctor-review/latest
# ============================================================
@router.get("/{screening_id}/doctor-review/latest")
def get_latest_doctor_review(screening_id: UUID):
    try:
        sid = str(screening_id)

        res = (
            supabase.table("doctor_reviews")
            .select("*")
            .eq("screening_session_id", sid)
            .order("reviewed_at", desc=True)
            .limit(1)
            .execute()
        )

        latest = _first(res.data or [])
        return {"ok": True, "data": latest}  # can be None

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Doctor Review (approved/overridden + lock session)
# POST /screenings/{screening_id}/doctor-review
# ============================================================
@router.post("/{screening_id}/doctor-review")
def doctor_review(screening_id: UUID, payload: DoctorReviewRequest):
    try:
        sid = str(screening_id)

        # 1) Fetch session
        session_res = (
            supabase.table("screening_sessions")
            .select("id, status, assigned_doctor_id")
            .eq("id", sid)
            .single()
            .execute()
        )
        session = session_res.data
        if not session:
            raise HTTPException(status_code=404, detail="Screening session not found")

        status = _norm_status(session.get("status"))

        # 2) Block if already locked
        if status in LOCKED_STATUSES:
            raise HTTPException(
                status_code=403, detail=f"Session already locked (status={status})"
            )

        # 3) Ensure only assigned doctor can review (if assigned)
        assigned_doctor_id = session.get("assigned_doctor_id")
        if assigned_doctor_id and str(assigned_doctor_id) != str(payload.doctor_id):
            raise HTTPException(
                status_code=403, detail="This session is assigned to a different doctor"
            )

        # 4) If overridden, require reason
        if payload.decision == "overridden":
            if not payload.override_reason or not payload.override_reason.strip():
                raise HTTPException(
                    status_code=400,
                    detail="override_reason is required when decision=overridden",
                )

        # 5) Insert doctor review
        insert_data = {
            "screening_session_id": sid,
            "doctor_id": str(payload.doctor_id),
            "decision": payload.decision,  # approved | overridden
            "reviewed_at": datetime.utcnow().isoformat(),
            "final_grade_left": payload.final_grade_left,
            "final_grade_right": payload.final_grade_right,
            "override_reason": payload.override_reason,
            "report_url": payload.report_url,
        }
        supabase.table("doctor_reviews").insert(insert_data).execute()

        # 6) Update session status to match decision
        supabase.table("screening_sessions").update({"status": payload.decision}).eq(
            "id", sid
        ).execute()

        return {
            "ok": True,
            "message": f"Doctor review saved. Session status set to '{payload.decision}'.",
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Send clinical report to patient
# POST /screenings/{session_id}/send-report
# ============================================================

class SendReportRequest(BaseModel):
    patient_email: str
    report_html: str
    patient_name: str


@router.post("/{session_id}/send-report")
def send_report_to_patient(session_id: UUID, payload: SendReportRequest):
    converted_html = markdown.markdown(payload.report_html, extensions=["extra"])
    converted_html = re.sub(
        r'(<h[123][^>]*>)(.*?Clinical Summary for.*?)(</h[123]>)',
        rf'\1Clinical Summary for {payload.patient_name}\3',
        converted_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    converted_html = re.sub(
        r'<h[1-6][^>]*>\s*Disclaimer\s*</h[1-6]>\s*<p>.*?</p>',
        '',
        converted_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    ok = send_clinical_report(
        patient_name=payload.patient_name,
        patient_email=payload.patient_email,
        report_html=converted_html,
        session_id=str(session_id),
    )
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to send clinical report email.")
    return {"success": True}


# ============================================================
# Doctor-signature report flow (preview + finalize)
# Bucket for finalized report PDFs
# ============================================================
REPORTS_BUCKET = "reports"
MC_BUCKET = "medical-certificates"


class ReportPreviewRequest(BaseModel):
    report_markdown: str
    signature_data_url: str
    patient_name: str
    doctor_name: Optional[str] = None

    # Doctor's Clinical Assessment fields
    physical_exam: Optional[Dict[str, Any]] = None
    prescription: Optional[List[Dict[str, Any]]] = None
    clinical_impression: Optional[str] = None
    management_plan: Optional[str] = None
    follow_up_interval: Optional[str] = None


class FinalizeReviewRequest(BaseModel):
    doctor_id: str
    decision: str
    override_reason: Optional[str] = None
    final_grade_left: Optional[str] = None
    final_grade_right: Optional[str] = None
    report_markdown: str
    signature_data_url: str
    patient_name: str
    patient_email: Optional[str] = None
    doctor_name: Optional[str] = None
    send_to_patient: bool

    # Doctor's Clinical Assessment fields
    physical_exam: Optional[Dict[str, Any]] = None
    prescription: Optional[List[Dict[str, Any]]] = None
    clinical_impression: Optional[str] = None
    management_plan: Optional[str] = None
    follow_up_interval: Optional[str] = None

    # Medical Certificate fields
    mc_issue: bool = False
    mc_days: Optional[int] = None
    mc_date_from: Optional[str] = None
    mc_date_to: Optional[str] = None
    mc_reason: Optional[str] = None


class MCPreviewRequest(BaseModel):
    patient_name: str
    ic_passport: Optional[str] = None
    days: Optional[int] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    reason: Optional[str] = None
    signature_data_url: str
    doctor_name: Optional[str] = None


# ------------------------------------------------------------
# Preview the signed report PDF (NO database writes)
# POST /screenings/sessions/{session_id}/report-preview
# ------------------------------------------------------------
@router.post("/sessions/{session_id}/report-preview")
def report_preview(session_id: UUID, payload: ReportPreviewRequest):
    try:
        pdf_bytes = generate_report_pdf(
            payload.patient_name,
            payload.report_markdown,
            payload.signature_data_url,
            payload.doctor_name,
            physical_exam=payload.physical_exam,
            prescription=payload.prescription,
            clinical_impression=payload.clinical_impression,
            management_plan=payload.management_plan,
            follow_up_interval=payload.follow_up_interval,
        )
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="preview.pdf"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate preview PDF: {e}")


# ------------------------------------------------------------
# Preview the MC PDF (NO database writes — Option A).
# Uses placeholder cert no "PREVIEW"; the real 5-digit number is only
# stamped at finalize. Mirrors report-preview.
# POST /screenings/sessions/{session_id}/mc-preview
# ------------------------------------------------------------
@router.post("/sessions/{session_id}/mc-preview")
def mc_preview(session_id: UUID, payload: MCPreviewRequest):
    try:
        mc_date = datetime.now(ZoneInfo("Asia/Kuala_Lumpur")).strftime("%Y-%m-%d")
        pdf_bytes = generate_mc_pdf(
            "PREVIEW",  # placeholder — preview writes nothing, no real number yet
            mc_date,
            payload.patient_name,
            payload.ic_passport or "",
            payload.days,
            payload.date_from,
            payload.date_to,
            payload.reason,
            signature_data_url=payload.signature_data_url,
            doctor_name=payload.doctor_name,
        )
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="mc_preview.pdf"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate MC preview PDF: {e}")


# ------------------------------------------------------------
# Finalize the review: generate PDF, store it, write DB rows,
# optionally email the patient.
# POST /screenings/sessions/{session_id}/finalize-review
# ------------------------------------------------------------
@router.post("/sessions/{session_id}/finalize-review")
def finalize_review(session_id: UUID, payload: FinalizeReviewRequest):
    try:
        sid = str(session_id)

        # 1) Generate the signed PDF
        pdf_bytes = generate_report_pdf(
            payload.patient_name,
            payload.report_markdown,
            payload.signature_data_url,
            payload.doctor_name,
            physical_exam=payload.physical_exam,
            prescription=payload.prescription,
            clinical_impression=payload.clinical_impression,
            management_plan=payload.management_plan,
            follow_up_interval=payload.follow_up_interval,
        )

        # 2) Upload PDF to the `reports` bucket (mirror retinal-scans pattern)
        path = f"{sid}.pdf"
        storage = supabase.storage.from_(REPORTS_BUCKET)
        storage.upload(
            path,
            pdf_bytes,
            file_options={"content-type": "application/pdf", "upsert": "true"},
        )
        report_url = storage.get_public_url(path)

        # 3) Update session status to match decision (same as doctor-review)
        supabase.table("screening_sessions").update(
            {"status": payload.decision}
        ).eq("id", sid).execute()

        # 4) Insert doctor review row (same shape as doctor-review + report_url)
        insert_data = {
            "screening_session_id": sid,
            "doctor_id": str(payload.doctor_id),
            "decision": payload.decision,
            "reviewed_at": datetime.utcnow().isoformat(),
            "final_grade_left": payload.final_grade_left,
            "final_grade_right": payload.final_grade_right,
            "override_reason": payload.override_reason,
            "report_url": report_url,
            # Doctor's Clinical Assessment
            "physical_exam": payload.physical_exam,
            "prescription": payload.prescription,
            "clinical_impression": payload.clinical_impression,
            "management_plan": payload.management_plan,
            "follow_up_interval": payload.follow_up_interval,
        }
        supabase.table("doctor_reviews").insert(insert_data).execute()

        # 5) Optionally generate + store a Medical Certificate (gated on mc_issue)
        mc_url = None
        mc_bytes = None
        if payload.mc_issue:
            try:
                # 5a) Resolve patient identity from the DB (never trust the client)
                sess_res = (
                    supabase.table("screening_sessions")
                    .select("patient_id")
                    .eq("id", sid)
                    .single()
                    .execute()
                )
                patient_id = (sess_res.data or {}).get("patient_id")
                if not patient_id:
                    raise HTTPException(status_code=404, detail="Patient not found for this session")

                pat_res = (
                    supabase.table("patients")
                    .select("name, ic_passport")
                    .eq("id", patient_id)
                    .single()
                    .execute()
                )
                patient = pat_res.data or {}
                mc_patient_name = patient.get("name") or payload.patient_name
                ic_passport = patient.get("ic_passport") or ""

                # 5b) Insert the MC row first to obtain the serial mc_number + id
                mc_insert = (
                    supabase.table("mc_certificates")
                    .insert({
                        "screening_session_id": sid,
                        "patient_id": patient_id,
                        "doctor_id": str(payload.doctor_id),
                        "days": payload.mc_days,
                        "date_from": payload.mc_date_from,
                        "date_to": payload.mc_date_to,
                        "reason": payload.mc_reason,
                    })
                    .execute()
                )
                mc_row = (mc_insert.data or [None])[0]
                if not mc_row:
                    raise HTTPException(status_code=500, detail="Failed to create MC record")
                mc_id = mc_row.get("id")
                mc_number = mc_row.get("mc_number")

                # 5c) Generate the MC PDF (KL-local date, never naive)
                certificate_no = f"{int(mc_number):05d}"
                mc_date = datetime.now(ZoneInfo("Asia/Kuala_Lumpur")).strftime("%Y-%m-%d")
                mc_bytes = generate_mc_pdf(
                    certificate_no,
                    mc_date,
                    mc_patient_name,
                    ic_passport,
                    payload.mc_days,
                    payload.mc_date_from,
                    payload.mc_date_to,
                    payload.mc_reason,
                    signature_data_url=payload.signature_data_url,
                    doctor_name=payload.doctor_name,
                )

                # 5d) Upload to the medical-certificates bucket, then save mc_url
                mc_path = f"{mc_id}.pdf"
                mc_storage = supabase.storage.from_(MC_BUCKET)
                mc_storage.upload(
                    mc_path,
                    mc_bytes,
                    file_options={"content-type": "application/pdf", "upsert": "true"},
                )
                mc_url = mc_storage.get_public_url(mc_path)
                supabase.table("mc_certificates").update({"mc_url": mc_url}).eq("id", mc_id).execute()
            except HTTPException:
                raise
            except Exception as mc_err:
                raise HTTPException(status_code=500, detail=f"Failed to generate medical certificate: {mc_err}")

        # 6) Optionally email the report (+ MC) to the patient as ONE email
        emailed = False
        if payload.send_to_patient and payload.patient_email:
            safe_name = re.sub(r"[^a-zA-Z0-9]+", "_", payload.patient_name).strip("_")
            stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
            attachments = [(f"{safe_name}_{stamp}_report.pdf", pdf_bytes)]
            if mc_bytes is not None:
                attachments.append((f"{safe_name}_{stamp}_MC.pdf", mc_bytes))
            emailed = send_clinical_report(
                payload.patient_name,
                payload.patient_email,
                payload.report_markdown,
                sid,
                attachments=attachments,
            )

        # 7) Return result
        return {"success": True, "report_url": report_url, "emailed": emailed, "mc_url": mc_url}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to finalize review: {e}")


# ------------------------------------------------------------
# Re-send the ALREADY-SAVED signed PDF to the patient by email.
# No regeneration, no new signature — fetches doctor_reviews.report_url.
# POST /screenings/sessions/{session_id}/resend-report
# ------------------------------------------------------------
class ResendReportRequest(BaseModel):
    patient_name: str
    patient_email: str


@router.post("/sessions/{session_id}/resend-report")
def resend_report(session_id: UUID, payload: ResendReportRequest):
    try:
        sid = str(session_id)

        # 1) Latest doctor review row for this session
        review_res = (
            supabase.table("doctor_reviews")
            .select("report_url")
            .eq("screening_session_id", sid)
            .order("reviewed_at", desc=True)
            .limit(1)
            .execute()
        )
        latest = _first(review_res.data or [])
        report_url = latest.get("report_url") if latest else None
        if not report_url:
            raise HTTPException(status_code=404, detail="No saved report found for this session")

        # 2) Download the stored PDF bytes
        r = requests.get(report_url)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch stored report")
        pdf_bytes = r.content

        # 3) Email the saved PDF (cover-letter body; report_markdown unused now)
        ok = send_clinical_report(
            payload.patient_name,
            payload.patient_email,
            "",
            sid,
            pdf_bytes=pdf_bytes,
        )
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to send clinical report email.")

        return {"success": True}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------
# Download the ALREADY-SAVED signed PDF (view-only export).
# GET /screenings/sessions/{session_id}/report-pdf
# ------------------------------------------------------------
@router.get("/sessions/{session_id}/report-pdf")
def download_report_pdf(session_id: UUID):
    try:
        sid = str(session_id)

        # Latest doctor review row for this session
        review_res = (
            supabase.table("doctor_reviews")
            .select("report_url")
            .eq("screening_session_id", sid)
            .order("reviewed_at", desc=True)
            .limit(1)
            .execute()
        )
        latest = _first(review_res.data or [])
        report_url = latest.get("report_url") if latest else None
        if not report_url:
            raise HTTPException(status_code=404, detail="No saved report found")

        # Download the stored PDF bytes
        r = requests.get(report_url)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch stored report")

        return StreamingResponse(
            BytesIO(r.content),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="report_{sid}.pdf"'},
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------
# Latest Medical Certificate for a session (read-only display).
# GET /screenings/sessions/{session_id}/mc-certificate/latest
# ------------------------------------------------------------
@router.get("/sessions/{session_id}/mc-certificate/latest")
def get_latest_mc(session_id: UUID):
    try:
        sid = str(session_id)
        res = (
            supabase.table("mc_certificates")
            .select("*")
            .eq("screening_session_id", sid)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        latest = _first(res.data or [])
        return {"ok": True, "data": latest}  # can be None
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------
# Download the ALREADY-SAVED MC PDF (view-only export).
# Mirrors report-pdf. GET /screenings/sessions/{session_id}/mc-pdf
# ------------------------------------------------------------
@router.get("/sessions/{session_id}/mc-pdf")
def download_mc_pdf(session_id: UUID):
    try:
        sid = str(session_id)

        # Latest MC row for this session
        mc_res = (
            supabase.table("mc_certificates")
            .select("mc_url")
            .eq("screening_session_id", sid)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        latest = _first(mc_res.data or [])
        mc_url = latest.get("mc_url") if latest else None
        if not mc_url:
            raise HTTPException(status_code=404, detail="No saved MC found")

        # Download the stored PDF bytes
        r = requests.get(mc_url)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch stored MC")

        return StreamingResponse(
            BytesIO(r.content),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="mc_{sid}.pdf"'},
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------
# Delete screening session (SAFE: pending only + no uploads + not assigned)
# ---------------------------
@router.delete("/{session_id}")
def delete_screening_session(session_id: UUID):
    try:
        sid = str(session_id)

        # 1) Fetch session
        res = (
            supabase.table("screening_sessions")
            .select("*")
            .eq("id", sid)
            .single()
            .execute()
        )

        session = res.data
        if not session:
            raise HTTPException(status_code=404, detail="Screening session not found")

        status = _norm_status(session.get("status"))
        assigned_doctor_id = session.get("assigned_doctor_id")

        # 2) Allow delete ONLY for pending drafts
        if status != DELETABLE_STATUS:
            raise HTTPException(
                status_code=400,
                detail=f"Only '{DELETABLE_STATUS}' sessions can be deleted (current status='{status}').",
            )

        # 3) Block if assigned to a doctor
        if assigned_doctor_id:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete a session that is already assigned to a doctor.",
            )

        # 4) Block if any retinal uploads exist
        uploads = (
            supabase.table(UPLOADS_TABLE)
            .select("id")
            .eq(UPLOADS_FK_COL, sid)
            .limit(1)
            .execute()
        )
        if uploads.data:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete a session that already has uploaded images.",
            )

        # 5) Delete session
        supabase.table("screening_sessions").delete().eq("id", sid).execute()

        return {"ok": True, "deleted_session_id": sid}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
