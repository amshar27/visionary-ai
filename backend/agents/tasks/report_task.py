"""Writer's task: combine patient context, diagnostics, and the Researcher's
brief into a six-section markdown report and persist it."""
from crewai import Task

from backend.agents.agents.writer import writer


def build_report_task(screening_session_id: str, research_task) -> Task:
    return Task(
        description=(
            f"For screening session {screening_session_id}, use the Researcher's "
            f"evidence brief (provided via context) to write a clinical report.\n\n"
            f"Steps:\n"
            f"1. Use patient_context to fetch demographics and risk factors "
            f"(pass screening_session_id={screening_session_id}).\n"
            f"2. Use screening_history to fetch prior session severities "
            f"(use the patient_id returned by patient_context, and pass "
            f"exclude_session_id={screening_session_id}).\n"
            f"3. Use diagnostic_assembler to format current AI/doctor diagnoses "
            f"(pass screening_session_id={screening_session_id}).\n"
            f"4. Use doctor_lookup to get the assigned doctor's name "
            f"(pass screening_session_id={screening_session_id}).\n"
            f"5. Write a six-section markdown report:\n"
            f"   - Title: exactly '### Clinical Summary for {{doctor_name}}'\n"
            f"   - Diagnostic Summary: per eye, with confidence for AI "
            f"predictions only (NEVER show confidence for doctor-confirmed eyes). "
            f"Compare with prior history and note if new, stable, or worsened.\n"
            f"   - Patient Risk Profile: diabetes, comorbidities, glaucoma "
            f"family history, IOP history, previous eye surgery, visual symptoms\n"
            f"   - Key Clinical Features: typical retinal signs for the condition\n"
            f"   - Recommended Management: tailored timeline + follow-up using "
            f"the Researcher's brief\n"
            f"   - Disclaimer: this is AI-assisted, not a diagnosis\n"
            f"6. Use report_persist to save the final markdown to ai_results "
            f"(pass screening_session_id={screening_session_id} and the full "
            f"markdown report as rag_summary).\n"
            f"7. After persisting, return ONLY the markdown report itself as "
            f"your final answer — no JSON wrapping, no code fences, no tool "
            f"output messages.\n\n"
        ),
        expected_output=(
            "The complete six-section markdown clinical report, exactly as it "
            "was passed to report_persist. Start your answer with '### Clinical "
            "Summary for' and end with the disclaimer paragraph. Output ONLY "
            "the markdown — no JSON, no code fences, no commentary, no tool "
            "call summaries, no 'Final Answer:' prefix, nothing else."
        ),
        agent=writer,
        context=[research_task],
    )
