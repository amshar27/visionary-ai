"""Researcher's revision task: fix only the issues flagged by the Brief Critic
and return a corrected evidence brief in the same format as the original
research task."""
from crewai import Task

from backend.agents.agents.researcher import researcher


def build_research_revision_task(screening_session_id: str, research_task, brief_critique_task) -> Task:
    return Task(
        description=(
            f"You previously produced an evidence brief for screening session "
            f"{screening_session_id}. The Brief Critic has identified specific "
            "problems with it. Your job is to produce a corrected brief.\n\n"
            "Instructions:\n"
            "1. Read the original brief from the context (research_task output)\n"
            "2. Read the critic verdict from the context (brief_critique_task output) — "
            "   focus on revision_instruction and failed_checks\n"
            "3. Fix ONLY the issues named in failed_checks. Examples:\n"
            "   - retrieval_failed → re-run guideline_retrieval with a refined "
            "     search query (you may re-run severity_classifier first to "
            "     reconstruct the query if needed)\n"
            "   - missing_referral_timeline → add the referral timeline section "
            "     using the retrieved guidelines\n"
            "   - missing_management_steps → add at least 2 specific management "
            "     steps grounded in the retrieved guidelines\n"
            "   - missing_urgent_triggers → add the urgent trigger criteria for "
            "     the classified severity\n"
            "   - severity_mismatch → realign the follow-up interval with the "
            "     classified severity\n"
            "4. Do not rewrite sections that were not flagged — preserve their "
            "   original content verbatim where possible\n"
            "5. Return the corrected evidence brief in the SAME FORMAT as the "
            "   original research task: a markdown brief with the four sections "
            "   (referral timeline, management steps, urgent triggers, follow-up "
            "   intervals) and a 'Sources:' line listing the source PDF filenames. "
            "   Preserve the HIGHEST-PRIORITY escalation labelling on urgent "
            "   triggers and referral timeline items so the downstream Writer can "
            "   still use that priority signal."
        ),
        expected_output=(
            "A corrected markdown evidence brief with the four required sections "
            "(referral timeline, management steps, urgent triggers, follow-up "
            "intervals) and a 'Sources:' line listing the source PDF filenames. "
            "Highest-priority escalation items remain flagged. No code fences, "
            "no 'Final Answer:' prefix."
        ),
        agent=researcher,
        context=[research_task, brief_critique_task],
    )
