"""Resolves the assigned doctor's display name from a screening session UUID."""
import logging
from typing import Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from backend.db import supabase

logger = logging.getLogger(__name__)


class DoctorLookupInput(BaseModel):
    screening_session_id: str = Field(
        ..., description="UUID of the screening session"
    )


class DoctorLookupTool(BaseTool):
    name: str = "doctor_lookup"
    description: str = (
        "Returns the assigned doctor's display name for a screening session. "
        "Falls back to the literal string 'Doctor' if no doctor is assigned or "
        "the lookup fails."
    )
    args_schema: Type[BaseModel] = DoctorLookupInput

    def _run(self, screening_session_id: str) -> dict:
        try:
            session_res = (
                supabase.table("screening_sessions")
                .select("assigned_doctor_id")
                .eq("id", screening_session_id)
                .single()
                .execute()
            )
        except Exception as e:
            logger.warning(f"Session lookup failed: {e}")
            return {"doctor_name": "Doctor"}

        doctor_id = (session_res.data or {}).get("assigned_doctor_id")
        if not doctor_id:
            return {"doctor_name": "Doctor"}

        try:
            doc_res = (
                supabase.table("staff_users")
                .select("name")
                .eq("id", doctor_id)
                .single()
                .execute()
            )
            name = (doc_res.data or {}).get("name") or "Doctor"
            return {"doctor_name": name}
        except Exception as e:
            logger.warning(f"Could not fetch doctor name: {e}")
            return {"doctor_name": "Doctor"}
