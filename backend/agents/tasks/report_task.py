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
            f"(pass screening_session_id={screening_session_id}).\n"
            f"3. Use diagnostic_assembler to format current AI/doctor diagnoses "
            f"(pass screening_session_id={screening_session_id}).\n"
            f"4. Use doctor_lookup to get the assigned doctor's name "
            f"(pass screening_session_id={screening_session_id}).\n"
            f"5. Write a six-section markdown report. Throughout the report, "
            f"you must SYNTHESIZE — do not merely restate facts. Weave the "
            f"Researcher's evidence brief together with this specific patient's "
            f"risk profile so every clinical statement is anchored to both the "
            f"guidelines and the patient in front of the doctor.\n"
            f"   - Title: exactly '### Clinical Summary for {{doctor_name}}'\n"
            f"   - Diagnostic Summary: per eye, with confidence for AI "
            f"predictions only (NEVER show confidence for doctor-confirmed eyes). "
            f"Compare with prior history and note if new, stable, or worsened. "
            f"After listing the per-eye findings, add an INTERPRETIVE sentence "
            f"(or two) that reasons about what these findings mean in light of "
            f"the patient's profile — e.g. how the severity, laterality, or "
            f"trend interacts with their diabetes duration, glaucoma family "
            f"history, IOP history, or visual symptoms. Do not simply restate "
            f"the prediction; explain its clinical significance for THIS "
            f"patient.\n"
            f"   - Patient Risk Profile: diabetes, comorbidities, glaucoma "
            f"family history, IOP history, previous eye surgery, visual symptoms\n"
            f"   - Key Clinical Features: typical retinal signs for the "
            f"condition, BUT do not stop at a generic list. Incorporate the "
            f"Researcher's urgent action triggers and referral indications, "
            f"and for each one explicitly state whether THIS patient's "
            f"risk factors raise concern under those triggers. For example, if "
            f"the guidelines flag elevated IOP or strong family history as "
            f"escalation criteria and this patient has either, call that out "
            f"directly. If the patient reports severe visual symptoms (e.g. "
            f"sudden vision loss, floaters, halos), tie those symptoms to the "
            f"guideline triggers they satisfy. Be specific and patient-anchored, "
            f"not generic.\n"
            f"   - Recommended Management: a tailored plan that goes beyond "
            f"follow-up intervals. Pull from the Researcher's brief ALL of: "
            f"(a) referral timeline and urgency, (b) key management steps, "
            f"(c) urgent action triggers the doctor should watch for, and "
            f"(d) follow-up interval. Then connect each recommendation to "
            f"this patient — e.g. 'Given this patient's elevated IOP history "
            f"and family history of glaucoma, the guidelines' threshold for "
            f"urgent referral is met / not met because ...'. The management "
            f"section should read as a reasoned clinical plan, not a bullet "
            f"dump of guideline excerpts.\n"
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
