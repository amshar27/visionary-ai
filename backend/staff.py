from fastapi import APIRouter, HTTPException
from .db import supabase

router = APIRouter(prefix="/staff", tags=["staff"])

@router.get("/doctors")
def list_doctors():
    """
    Returns all doctors from staff_users.
    Needed for nurse to select a doctor in the UI.
    """
    try:
        res = (
            supabase.table("staff_users")
            .select("id,email,role,name,created_at")
            .eq("role", "doctor")
            .order("name", desc=False)
            .execute()
        )
        return {"ok": True, "data": res.data or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
