# backend/admin.py

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Any, Dict

from .db import supabase
from .auth_utils import hash_password

router = APIRouter(prefix="/admin", tags=["admin"])


def assert_admin(role: Optional[str]):
    if (role or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")


# =========================================================
# STAFF USERS (staff_users)
# =========================================================

class UpdateStaffUserNameRequest(BaseModel):
    requester_role: str
    name: Optional[str] = None


class ResetStaffUserPasswordRequest(BaseModel):
    requester_role: str
    new_password: str = Field(min_length=6)


class DeleteStaffUserByStaffIdRequest(BaseModel):
    requester_role: str


@router.get("/staff-users")
def list_staff_users(role: str):
    assert_admin(role)
    try:
        res = (
            supabase.table("staff_users")
            .select("staff_id,email,role,name")
            .order("staff_id")
            .execute()
        )
        return {"ok": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch staff users: {e}")


@router.patch("/staff-users/{staff_id}")
def update_staff_user_name(staff_id: str, payload: UpdateStaffUserNameRequest):
    assert_admin(payload.requester_role)

    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty.")

    try:
        existing = (
            supabase.table("staff_users")
            .select("staff_id")
            .eq("staff_id", staff_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            raise HTTPException(status_code=404, detail="User not found for this Staff ID.")

        res = (
            supabase.table("staff_users")
            .update({"name": name})
            .eq("staff_id", staff_id)
            .execute()
        )

        return {
            "ok": True,
            "message": "User name updated successfully.",
            "data": res.data[0] if res.data else {"staff_id": staff_id, "name": name},
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update user: {e}")


@router.patch("/staff-users/{staff_id}/password")
def reset_staff_user_password(staff_id: str, payload: ResetStaffUserPasswordRequest):
    assert_admin(payload.requester_role)

    new_password = (payload.new_password or "").strip()
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    try:
        existing = (
            supabase.table("staff_users")
            .select("staff_id")
            .eq("staff_id", staff_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            raise HTTPException(status_code=404, detail="User not found for this Staff ID.")

        hashed = hash_password(new_password)
        supabase.table("staff_users").update({"password_hash": hashed}).eq("staff_id", staff_id).execute()

        return {"ok": True, "message": "Password updated successfully.", "staff_id": staff_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset password: {e}")


@router.delete("/staff-users/{staff_id}")
def delete_staff_user_by_staff_id(staff_id: str, payload: DeleteStaffUserByStaffIdRequest):
    assert_admin(payload.requester_role)

    try:
        existing = (
            supabase.table("staff_users")
            .select("staff_id")
            .eq("staff_id", staff_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            raise HTTPException(status_code=404, detail="User not found for this Staff ID.")

        res = supabase.table("staff_users").delete().eq("staff_id", staff_id).execute()
        return {"ok": True, "message": "User deleted successfully.", "deleted_staff_id": staff_id, "data": res.data}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete staff user: {e}")


# =========================================================
# PATIENTS (patients)
# UX: Identify row by IC/Passport
# Admin can ONLY update: name, ic_passport, contact_number
# =========================================================

class UpdatePatientByICRequest(BaseModel):
    requester_role: str
    name: Optional[str] = None
    ic_passport: Optional[str] = None
    contact_number: Optional[str] = None


class DeletePatientByICRequest(BaseModel):
    requester_role: str


@router.get("/patients")
def list_patients(role: str):
    assert_admin(role)
    try:
        res = (
            supabase.table("patients")
            .select(
                "id,name,ic_passport,age,sex,contact_number,diabetes_known,diabetes_type,"
                "diabetes_duration_years,comorbidities,allergies,notes,created_at,created_by"
            )
            .order("created_at", desc=True)
            .execute()
        )
        return {"ok": True, "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch patients: {e}")


@router.patch("/patients/by-ic/{ic_passport}")
def update_patient_by_ic(ic_passport: str, payload: UpdatePatientByICRequest):
    assert_admin(payload.requester_role)

    old_ic = (ic_passport or "").strip()
    if not old_ic:
        raise HTTPException(status_code=400, detail="IC/Passport is required.")

    # Build allowed updates only
    updates: Dict[str, Any] = {}
    if payload.name is not None:
        nm = payload.name.strip()
        if not nm:
            raise HTTPException(status_code=400, detail="Name cannot be empty.")
        updates["name"] = nm

    if payload.ic_passport is not None:
        new_ic = payload.ic_passport.strip()
        if not new_ic:
            raise HTTPException(status_code=400, detail="IC/Passport cannot be empty.")
        updates["ic_passport"] = new_ic

    if payload.contact_number is not None:
        phone = payload.contact_number.strip()
        if not phone:
            raise HTTPException(status_code=400, detail="Contact number cannot be empty.")
        updates["contact_number"] = phone

    if not updates:
        raise HTTPException(status_code=400, detail="No update fields provided (name/ic_passport/contact_number only).")

    try:
        # Find patient by OLD ic_passport
        existing = (
            supabase.table("patients")
            .select("id,ic_passport")
            .eq("ic_passport", old_ic)
            .limit(2)
            .execute()
        )
        if not existing.data:
            raise HTTPException(status_code=404, detail="Patient not found for this IC/Passport.")
        if len(existing.data) > 1:
            raise HTTPException(status_code=409, detail="Duplicate IC/Passport found. Please enforce uniqueness in DB.")

        patient_id = existing.data[0]["id"]

        # If changing IC, ensure new IC doesn't already exist
        if "ic_passport" in updates and updates["ic_passport"] != old_ic:
            check = (
                supabase.table("patients")
                .select("id")
                .eq("ic_passport", updates["ic_passport"])
                .limit(1)
                .execute()
            )
            if check.data:
                raise HTTPException(status_code=409, detail="New IC/Passport already exists for another patient.")

        res = supabase.table("patients").update(updates).eq("id", patient_id).execute()

        return {
            "ok": True,
            "message": "Patient updated successfully.",
            "data": res.data[0] if res.data else {"id": patient_id, **updates},
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update patient: {e}")


@router.delete("/patients/by-ic/{ic_passport}")
def delete_patient_by_ic(ic_passport: str, payload: DeletePatientByICRequest):
    assert_admin(payload.requester_role)

    ic_clean = (ic_passport or "").strip()
    if not ic_clean:
        raise HTTPException(status_code=400, detail="IC/Passport is required.")

    try:
        existing = (
            supabase.table("patients")
            .select("id,ic_passport")
            .eq("ic_passport", ic_clean)
            .limit(2)
            .execute()
        )
        if not existing.data:
            raise HTTPException(status_code=404, detail="Patient not found for this IC/Passport.")
        if len(existing.data) > 1:
            raise HTTPException(status_code=409, detail="Duplicate IC/Passport found. Please enforce uniqueness in DB.")

        patient_id = existing.data[0]["id"]

        res = supabase.table("patients").delete().eq("id", patient_id).execute()
        return {
            "ok": True,
            "message": "Patient deleted successfully.",
            "deleted_patient_id": patient_id,
            "deleted_ic_passport": ic_clean,
            "data": res.data,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete patient: {e}")
