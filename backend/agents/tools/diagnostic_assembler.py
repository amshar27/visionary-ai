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
            # A doctor override is the authoritative diagnosis. `disease_type`
            # and `severity_label` are ONLY ever written by PATCH /ai/result
            # (never by /ai/analyze), so a populated `disease_type` is the
            # robust signal that this eye was doctor-edited — independent of
            # whether `dr_severity`/`confidence_score` happen to still hold
            # stale AI values (e.g. after a re-analysis). The old check keyed
            # only off `dr_severity is None`, which silently fell back to the
            # AI prediction (and its confidence) if those columns were ever
            # repopulated. Keep the legacy condition as a fallback.
            is_edited = bool(result.get("disease_type")) or (
                result.get("dr_severity") is None
                and result.get("severity_label") is not None
            )

            if is_edited:
                # Prefer the doctor's severity_label over any lingering
                # AI dr_severity, and never show a confidence figure.
                disease_type = (result.get("disease_type") or "").strip()
                detected = str(result.get("disease_detected") or "").strip().lower()
                # A doctor can confirm "no disease" — disease_detected = "No"
                # with empty/placeholder disease_type & severity_label. Render
                # that as a clean clinical phrase instead of "N/A — N/a".
                has_disease = (
                    disease_type.lower() not in ("", "n/a", "none")
                    and detected not in ("no", "false", "none")
                )
                if has_disease:
                    severity = (
                        result.get("severity_label")
                        or result.get("dr_severity")
                        or "none"
                    )
                    lines.append(
                        f"- **{eye} Eye**: {disease_type} — "
                        f"{severity.capitalize()} *(doctor-confirmed)*"
                    )
                else:
                    lines.append(
                        f"- **{eye} Eye**: No disease detected "
                        f"*(doctor-confirmed)*"
                    )
            else:
                severity = (
                    result.get("dr_severity")
                    or result.get("severity_label")
                    or "none"
                )
                confidence = result.get("confidence_score") or 0.0
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
