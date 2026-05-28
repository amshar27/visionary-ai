"""Fetches up to 3 prior screening sessions for a patient and formats their
per-eye severities as a markdown bullet list."""
import logging
from typing import Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from backend.db import supabase

logger = logging.getLogger(__name__)


class ScreeningHistoryInput(BaseModel):
    screening_session_id: str = Field(
        ...,
        description="UUID of the current screening session. The tool resolves "
        "the patient_id internally and excludes this session from history.",
    )


class ScreeningHistoryTool(BaseTool):
    name: str = "screening_history"
    description: str = (
        "Fetches up to 3 most-recent prior screening sessions for the patient "
        "behind the given screening_session_id (excluding the current session) "
        "and returns their per-eye severities as a markdown bullet string."
    )
    args_schema: Type[BaseModel] = ScreeningHistoryInput

    def _run(self, screening_session_id: str) -> dict:
        logger.info(
            "[screening_history] called with screening_session_id=%r",
            screening_session_id,
        )

        session_row = (
            supabase.table("screening_sessions")
            .select("patient_id")
            .eq("id", screening_session_id)
            .single()
            .execute()
        )
        patient_id = (session_row.data or {}).get("patient_id")
        logger.info(
            "[screening_history] resolved patient_id=%r for session=%r",
            patient_id,
            screening_session_id,
        )

        if not patient_id:
            return {"past_history": "No previous screening records found."}

        past = (
            supabase.table("screening_sessions")
            .select("id, session_date")
            .eq("patient_id", patient_id)
            .neq("id", screening_session_id)
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
