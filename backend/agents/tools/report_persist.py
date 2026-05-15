"""Writes the final markdown report to ai_results.rag_summary for every row
belonging to the given session. Failure here is non-fatal — the writer agent
should still return the report to the caller."""
import logging
from typing import Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from backend.db import supabase

logger = logging.getLogger(__name__)


class ReportPersistInput(BaseModel):
    screening_session_id: str = Field(
        ..., description="UUID of the screening session"
    )
    rag_summary: str = Field(
        ..., description="Final markdown report to persist to ai_results.rag_summary"
    )


class ReportPersistTool(BaseTool):
    name: str = "report_persist"
    description: str = (
        "Persists the final markdown clinical summary to "
        "ai_results.rag_summary for every row of the given session. Returns "
        "{ok: bool, error?: str}. Failure is non-fatal — the report should "
        "still be returned to the caller."
    )
    args_schema: Type[BaseModel] = ReportPersistInput

    def _run(self, screening_session_id: str, rag_summary: str) -> dict:
        try:
            supabase.table("ai_results").update(
                {"rag_summary": rag_summary}
            ).eq("screening_session_id", screening_session_id).execute()
            return {"ok": True}
        except Exception as e:
            logger.warning(f"Failed to persist rag_summary: {e}")
            return {"ok": False, "error": str(e)}
