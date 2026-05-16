from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal
from uuid import UUID
from datetime import datetime

import re
import markdown

from .db import supabase
from .notification_service import send_clinical_report

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
