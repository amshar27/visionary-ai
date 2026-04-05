from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from .db import supabase
from .notification_service import send_appointment_confirmation

router = APIRouter(prefix="/appointments", tags=["appointments"])


# ─── Pydantic Schemas ─────────────────────────────────────────────────────────

class AppointmentCreate(BaseModel):
    patient_id: str
    scheduled_by: str
    appointment_datetime: datetime
    notes: Optional[str] = None
    assigned_doctor_id: Optional[str] = None

class AppointmentStatusUpdate(BaseModel):
    status: Optional[str] = None   # scheduled | completed | cancelled | no_show
    notes: Optional[str] = None

class AppointmentOut(BaseModel):
    id: str
    patient_id: str
    scheduled_by: str
    appointment_datetime: datetime
    status: str
    notes: Optional[str]
    confirmation_sent_at: Optional[datetime]
    notification_sent_at: Optional[datetime]
    created_at: datetime
    patient_name: Optional[str] = None
    patient_email: Optional[str] = None
    assigned_doctor_id: Optional[str] = None


# ─── POST /appointments ───────────────────────────────────────────────────────

@router.post("", response_model=AppointmentOut, status_code=201)
def create_appointment(payload: AppointmentCreate):
    now = datetime.now(timezone.utc)
    if payload.appointment_datetime <= now:
        raise HTTPException(status_code=400, detail="Appointment must be scheduled in the future.")

    # 1. Fetch patient (name + email)
    patient_resp = (
        supabase.table("patients")
        .select("id, name, email")
        .eq("id", payload.patient_id)
        .single()
        .execute()
    )
    if not patient_resp.data:
        raise HTTPException(status_code=404, detail="Patient not found")
    patient = patient_resp.data

    # 2. Overlap check — reject if the doctor has any active appointment within 30 minutes
    if payload.assigned_doctor_id:
        incoming_dt = datetime.fromisoformat(str(payload.appointment_datetime))
        if incoming_dt.tzinfo is None:
            incoming_dt = incoming_dt.replace(tzinfo=timezone.utc)

        existing = supabase.table("appointments") \
            .select("appointment_datetime") \
            .eq("assigned_doctor_id", payload.assigned_doctor_id) \
            .not_.in_("status", ["cancelled", "no_show"]) \
            .execute()

        for appt in existing.data:
            existing_dt = datetime.fromisoformat(appt["appointment_datetime"])
            if existing_dt.tzinfo is None:
                existing_dt = existing_dt.replace(tzinfo=timezone.utc)
            diff = abs((incoming_dt - existing_dt).total_seconds())
            if diff < 1800:
                raise HTTPException(
                    status_code=409,
                    detail="Appointments must be at least 30 minutes apart. Please choose a different time slot.",
                )

    # 3. Insert appointment
    insert_payload = {
        "patient_id": payload.patient_id,
        "scheduled_by": payload.scheduled_by,
        "appointment_datetime": payload.appointment_datetime.isoformat(),
        "notes": payload.notes,
        "assigned_doctor_id": payload.assigned_doctor_id,
    }
    insert_resp = supabase.table("appointments").insert(insert_payload).execute()
    if not insert_resp.data:
        raise HTTPException(status_code=500, detail="Failed to create appointment")

    appointment = insert_resp.data[0]
    appointment_id = appointment["id"]

    # 3. Send confirmation email if patient has email, then stamp confirmation_sent_at
    if patient.get("email"):
        sent = send_appointment_confirmation(
            patient_name=patient["name"],
            patient_email=patient["email"],
            appointment_datetime=payload.appointment_datetime,
            notes=payload.notes,
        )
        if sent:
            stamp_resp = (
                supabase.table("appointments")
                .update({"confirmation_sent_at": datetime.utcnow().isoformat()})
                .eq("id", appointment_id)
                .execute()
            )
            if stamp_resp.data:
                appointment = stamp_resp.data[0]

    appointment["patient_name"] = patient["name"]
    appointment["patient_email"] = patient.get("email")
    return appointment


# ─── GET /appointments ────────────────────────────────────────────────────────

@router.get("", response_model=list[AppointmentOut])
def list_appointments(
    patient_id: Optional[str] = None,
    assigned_doctor_id: Optional[str] = None,
):
    query = (
        supabase.table("appointments")
        .select("*, patients(name, email)")
        .order("appointment_datetime", desc=False)
    )
    if patient_id:
        query = query.eq("patient_id", patient_id)
    if assigned_doctor_id:
        query = query.eq("assigned_doctor_id", assigned_doctor_id)

    resp = query.execute()
    appointments = []
    for row in resp.data or []:
        patient_join = row.pop("patients", {}) or {}
        row["patient_name"] = patient_join.get("name")
        row["patient_email"] = patient_join.get("email")
        appointments.append(row)
    return appointments


# ─── PATCH /appointments/{id} ─────────────────────────────────────────────────

@router.patch("/{appointment_id}", response_model=AppointmentOut)
def update_appointment(appointment_id: str, payload: AppointmentStatusUpdate):
    update_data: dict = {}
    if payload.status is not None:
        update_data["status"] = payload.status
    if payload.notes is not None:
        update_data["notes"] = payload.notes

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    resp = (
        supabase.table("appointments")
        .update(update_data)
        .eq("id", appointment_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Appointment not found")

    appointment = resp.data[0]
    patient_resp = (
        supabase.table("patients")
        .select("name, email")
        .eq("id", appointment["patient_id"])
        .single()
        .execute()
    )
    patient = patient_resp.data or {}
    appointment["patient_name"] = patient.get("name")
    appointment["patient_email"] = patient.get("email")
    return appointment
