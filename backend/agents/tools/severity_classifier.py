"""Determines the worst-case condition across both eyes for a screening session
and builds the appropriate guideline search query."""
import logging
from typing import Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from backend.db import supabase

logger = logging.getLogger(__name__)

# Severity ranks. Cataract/Glaucoma are treated as their own conditions, so they
# don't appear here — they're picked up by checking the condition name string.
SEVERITY_LEVELS = {
    'none': 0,
    'mild': 1,
    'moderate': 2,
    'severe': 3,
    'proliferative': 4,
}


class SeverityClassifierInput(BaseModel):
    screening_session_id: str = Field(
        ..., description="UUID of the screening session to classify"
    )


class SeverityClassifierTool(BaseTool):
    name: str = "severity_classifier"
    description: str = (
        "Given a screening session UUID, returns the worst-case diagnosed "
        "condition across both eyes and the guideline search query to use. "
        "Output: {worst_condition_name, search_query}."
    )
    args_schema: Type[BaseModel] = SeverityClassifierInput

    def _run(self, screening_session_id: str) -> dict:
        ai_res = (
            supabase.table("ai_results")
            .select("*")
            .eq("screening_session_id", screening_session_id)
            .execute()
        )
        if not ai_res.data:
            return {
                "worst_condition_name": "No DR",
                "search_query": "management and referral guidelines for No DR diabetic retinopathy Malaysia",
            }

        worst_score = -1
        worst_condition_name = "No DR"
        for result in ai_res.data:
            # Read defensively — doctor edits null out dr_severity.
            severity = (
                result.get("dr_severity")
                or result.get("severity_label")
                or "none"
            )
            score = SEVERITY_LEVELS.get(severity.lower(), 0)
            if score > worst_score:
                worst_score = score
                worst_condition_name = severity

        # Same conditional as the existing pipeline (ai.py).
        if worst_condition_name.lower() in ["cataract", "glaucoma"]:
            search_query = (
                f"management and referral guidelines for {worst_condition_name} Malaysia"
            )
        else:
            search_query = (
                f"management and referral guidelines for {worst_condition_name} "
                f"diabetic retinopathy Malaysia"
            )

        return {
            "worst_condition_name": worst_condition_name,
            "search_query": search_query,
        }
