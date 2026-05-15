"""Fetches patient demographics + history and formats them as a markdown
bullet block, mirroring the existing /summarise-rag pipeline."""
import logging
from typing import Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from backend.db import supabase

logger = logging.getLogger(__name__)


class PatientContextInput(BaseModel):
    screening_session_id: str = Field(
        ..., description="UUID of the screening session"
    )


class PatientContextTool(BaseTool):
    name: str = "patient_context"
    description: str = (
        "Fetches patient demographics, diabetes history, comorbidities, glaucoma "
        "risk factors, prior eye surgery, visual symptoms, and clinical notes "
        "for the patient associated with the given screening session. Returns "
        "a markdown-formatted history block."
    )
    args_schema: Type[BaseModel] = PatientContextInput

    def _run(self, screening_session_id: str) -> dict:
        session_res = (
            supabase.table("screening_sessions")
            .select("patient_id")
            .eq("id", screening_session_id)
            .single()
            .execute()
        )
        if not session_res.data:
            return {"patient_history": "Patient not found.", "patient_id": None}

        patient_id = session_res.data["patient_id"]

        # The columns below are the canonical names. The legacy /summarise-rag
        # reads `family_history_glaucoma` and `elevated_iop` which don't exist
        # in the schema — that's why the existing report always shows "Unknown"
        # for those two fields. This tool reads the correct columns.
        patient_res = (
            supabase.table("patients")
            .select(
                "name, age, diabetes_known, diabetes_type, "
                "diabetes_duration_years, comorbidities, notes, "
                "glaucoma_family_history, elevated_iop_history, "
                "previous_eye_surgery, visual_symptoms"
            )
            .eq("id", patient_id)
            .single()
            .execute()
        )
        pt = patient_res.data or {}

        comorbidities = pt.get("comorbidities")
        if isinstance(comorbidities, list):
            comorbidities_str = ", ".join(comorbidities)
        else:
            comorbidities_str = str(comorbidities) if comorbidities else "None"

        history = (
            f"- Name: {pt.get('name', 'Unknown')}\n"
            f"- Age: {pt.get('age', 'N/A')}\n"
            f"- Known Diabetic: {pt.get('diabetes_known', 'N/A')}\n"
            f"- Type: {pt.get('diabetes_type', 'N/A')} "
            f"({pt.get('diabetes_duration_years', 0)} years)\n"
            f"- Comorbidities: {comorbidities_str}\n"
            f"- Family History of Glaucoma: "
            f"{pt.get('glaucoma_family_history', 'Unknown')}\n"
            f"- Previously Elevated IOP: "
            f"{pt.get('elevated_iop_history', 'Unknown')}\n"
            f"- Previous Eye Surgery or Trauma: "
            f"{pt.get('previous_eye_surgery', 'Unknown')}\n"
            f"- Visual Symptoms: {pt.get('visual_symptoms', 'None')}\n"
            f"- Clinical Notes: {pt.get('notes', 'None')}"
        )

        return {"patient_history": history, "patient_id": patient_id}
