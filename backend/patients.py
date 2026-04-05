# backend/patients.py

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from .db import supabase

router = APIRouter(prefix="/patients", tags=["patients"])


class PatientCreate(BaseModel):
    name: str
    ic_passport: str
    age: int
    sex: str  # must match enum values: 'M', 'F', 'Other'
    contact_number: str
    email: Optional[str] = None
    diabetes_known: str  # 'Yes', 'No', 'Unknown'
    diabetes_type: Optional[str] = None
    diabetes_duration_years: Optional[int] = None
    notes: Optional[str] = None
    glaucoma_family_history: Optional[str] = "Unknown"
    elevated_iop_history: Optional[str] = "Unknown"
    previous_eye_surgery: Optional[str] = "Unknown"
    visual_symptoms: Optional[str] = "None"


@router.get("")
def list_patients(
    q: Optional[str] = Query(default=None, description="Search by name or ic_passport"),
    limit: int = 50,
):
    """
    List patients.
    If q is provided, search by name OR ic_passport (case-insensitive).
    """
    try:
        query = (
            supabase.table("patients")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
        )

        if q:
            # case-insensitive partial match across both fields
            query = query.or_(f"name.ilike.%{q}%,ic_passport.ilike.%{q}%")

        res = query.execute()
        return {"ok": True, "data": res.data}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{patient_id}")
def get_patient(patient_id: str):
    """Get single patient by UUID id."""
    try:
        res = (
            supabase.table("patients")
            .select("*")
            .eq("id", patient_id)
            .single()
            .execute()
        )
        return {"ok": True, "data": res.data}

    except Exception as e:
        # Supabase will throw if not found / single() fails
        raise HTTPException(status_code=404, detail=f"Patient not found: {e}")


@router.post("")
def create_patient(payload: PatientCreate):
    """Create a new patient row."""
    try:
        res = supabase.table("patients").insert(payload.model_dump()).execute()
        return {"ok": True, "data": res.data}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
