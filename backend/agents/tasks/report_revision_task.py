"""Writer's revision task: fix only the issues flagged by the Report Critic
and persist the corrected report."""
from crewai import Task

from backend.agents.agents.writer import writer


def build_report_revision_task(screening_session_id: str, report_task, report_critique_task) -> Task:
    return Task(
        description=(
            f"You previously wrote a clinical report for screening session {screening_session_id}. "
            "The Report Critic has identified specific problems with it. "
            "Your job is to produce a corrected version.\n\n"
            "Instructions:\n"
            "1. Read the original report from the context (report_task output)\n"
            "2. Read the critic verdict from the context (report_critique_task output) — "
            "   focus on revision_instruction and failed_checks\n"
            "3. Fix ONLY the sections or issues identified in failed_checks\n"
            "4. Do not rewrite sections that were not flagged\n"
            f"5. Call report_persist to save the revised report "
            f"(pass screening_session_id={screening_session_id} and the full revised markdown as rag_summary)\n"
            "6. Return the complete corrected report as plain markdown — "
            "   no fences, no 'Final Answer:' prefix"
        ),
        expected_output=(
            "The complete corrected six-section clinical report as plain markdown. "
            "No code fences. No preamble. Starts directly with the first section heading."
        ),
        agent=writer,
        context=[report_task, report_critique_task],
    )
