"""Researcher's task: classify worst-case condition, retrieve guidelines,
condense into a structured brief."""
from crewai import Task

from backend.agents.agents.researcher import researcher


def build_research_task(screening_session_id: str) -> Task:
    return Task(
        description=(
            f"For screening session {screening_session_id}:\n"
            f"1. Use the severity_classifier tool to determine the worst-case "
            f"diagnosed condition and construct the appropriate search query.\n"
            f"2. Use the guideline_retrieval tool with that search query to "
            f"fetch relevant Malaysian ophthalmology guidelines.\n"
            f"3. Condense the retrieved guideline text into structured bullet "
            f"points covering:\n"
            f"   - Recommended referral timeline\n"
            f"   - Key management steps\n"
            f"   - Urgent action triggers\n"
            f"   - Follow-up intervals\n"
            f"Return a markdown-formatted brief plus the list of source filenames."
        ),
        expected_output=(
            "A markdown brief with the four required sections (referral "
            "timeline, management steps, urgent triggers, follow-up intervals) "
            "and a 'Sources:' line listing the source PDF filenames. Within "
            "the urgent triggers and referral timeline sections, explicitly "
            "flag which triggers/indications are the HIGHEST-PRIORITY ones to "
            "escalate on — i.e. mark or label the items that, if matched by a "
            "patient's risk profile (e.g. elevated IOP, family history of "
            "glaucoma, sudden vision loss, long-standing diabetes, severe "
            "visual symptoms), should drive urgent referral rather than "
            "routine follow-up. The downstream Writer relies on this priority "
            "signal to decide which triggers to weave into the patient-specific "
            "reasoning, so make the escalation hierarchy unambiguous."
        ),
        agent=researcher,
    )
