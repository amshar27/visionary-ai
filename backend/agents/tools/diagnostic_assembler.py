"""Formats current ai_results rows into the per-eye diagnostic bullets,
distinguishing AI predictions from doctor-confirmed overrides."""
import logging
from typing import Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from backend.db import supabase

logger = logging.getLogger(__name__)


class DiagnosticAssemblerInput(BaseModel):
    screening_session_id: str = Field(
        ..., description="UUID of the screening session"
    )


class DiagnosticAssemblerTool(BaseTool):
    name: str = "diagnostic_assembler"
    description: str = (
        "Formats per-eye AI diagnostic results for a screening session as "
        "markdown bullets. Doctor-edited eyes (dr_severity NULL with "
        "severity_label set) are tagged *(doctor-confirmed)* and rendered "
        "WITHOUT a confidence figure. Output: {diagnostic_data, session_date}."
    )
    args_schema: Type[BaseModel] = DiagnosticAssemblerInput

    def _run(self, screening_session_id: str) -> dict:
        session_res = (
            supabase.table("screening_sessions")
            .select("session_date")
            .eq("id", screening_session_id)
            .single()
            .execute()
        )
        session_date_raw = (session_res.data or {}).get("session_date")
        session_date = session_date_raw[:10] if session_date_raw else "Unknown Date"

        ai_res = (
            supabase.table("ai_results")
            .select("*")
            .eq("screening_session_id", screening_session_id)
            .execute()
        )
        if not ai_res.data:
            return {
                "diagnostic_data": "No AI analysis found for this session.",
                "session_date": session_date,
            }

        lines = []
        for result in ai_res.data:
            eye = (result.get("eye") or "").capitalize()
            # Doctor edits null out dr_severity but keep severity_label populated.
            is_edited = (
                result.get("dr_severity") is None
                and result.get("severity_label") is not None
            )
            severity = (
                result.get("dr_severity")
                or result.get("severity_label")
                or "none"
            )
            confidence = result.get("confidence_score") or 0.0

            if is_edited:
                disease_type = result.get("disease_type") or "Unknown"
                lines.append(
                    f"- **{eye} Eye**: {disease_type} — "
                    f"{severity.capitalize()} *(doctor-confirmed)*"
                )
            else:
                sev_lower = severity.lower()
                label = (
                    severity.capitalize()
                    if sev_lower in ["cataract", "glaucoma"]
                    else f"{severity.capitalize()} DR"
                )
                lines.append(
                    f"- **{eye} Eye**: Prediction: {label} | "
                    f"Confidence: {confidence:.1%}"
                )

        return {
            "diagnostic_data": "\n".join(lines),
            "session_date": session_date,
        }
