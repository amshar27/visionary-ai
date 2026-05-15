"""Fetches up to 3 prior screening sessions for a patient and formats their
per-eye severities as a markdown bullet list."""
import logging
from typing import Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from backend.db import supabase

logger = logging.getLogger(__name__)


class ScreeningHistoryInput(BaseModel):
    patient_id: str = Field(..., description="UUID of the patient")
    exclude_session_id: str = Field(
        ..., description="UUID of the current session to exclude from history"
    )


class ScreeningHistoryTool(BaseTool):
    name: str = "screening_history"
    description: str = (
        "Fetches up to 3 most-recent prior screening sessions for a patient "
        "(excluding the current one) and returns their per-eye severities as a "
        "markdown bullet string."
    )
    args_schema: Type[BaseModel] = ScreeningHistoryInput

    def _run(self, patient_id: str, exclude_session_id: str) -> dict:
        past = (
            supabase.table("screening_sessions")
            .select("id, session_date")
            .eq("patient_id", patient_id)
            .neq("id", exclude_session_id)
            .order("session_date", desc=True)
            .limit(3)
            .execute()
        )

        if not past.data:
            return {"past_history": "No previous screening records found."}

        lines = []
        for s in past.data:
            old_res = (
                supabase.table("ai_results")
                .select("eye, dr_severity, severity_label")
                .eq("screening_session_id", s["id"])
                .execute()
            )
            s_date = s["session_date"][:10] if s["session_date"] else "Unknown"
            if old_res.data:
                summary = ", ".join(
                    f"{(r.get('eye') or '').capitalize()}: "
                    f"{(r.get('dr_severity') or r.get('severity_label') or 'none').capitalize()}"
                    for r in old_res.data
                )
                lines.append(f"- {s_date}: {summary}")
            else:
                lines.append(f"- {s_date}: No AI results recorded")

        return {"past_history": "\n".join(lines) if lines else "No previous screening records found."}
