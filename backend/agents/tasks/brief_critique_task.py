"""Brief Critic's task: audit the Researcher's evidence brief and emit a
JSON verdict (verdict / failed_checks / revision_instruction)."""
from crewai import Task

from backend.agents.agents.brief_critic import brief_critic


def build_brief_critique_task(research_task) -> Task:
    return Task(
        description=(
            "Review the evidence brief produced by the Clinical Evidence Researcher. "
            "Apply the following rubric and output a JSON verdict.\n\n"
            "RUBRIC — mark as fail if ANY of these are true:\n"
            "1. No referral timeline is present for the classified severity\n"
            "2. Management steps are absent or fewer than 2 specific steps\n"
            "3. Urgent trigger criteria are absent for referable cases (severity >= moderate)\n"
            "4. No guideline chunks were retrieved (brief says retrieval failed or returned nothing)\n"
            "5. The recommended follow-up interval does not match the severity class\n\n"
            "Output format — raw JSON, no fences, no prose:\n"
            "{\n"
            '  "verdict": "pass" or "fail",\n'
            '  "failed_checks": ["missing_referral_timeline", ...],\n'
            '  "revision_instruction": "one actionable sentence for the Researcher, or empty string if pass"\n'
            "}\n\n"
            "Valid failed_check values: missing_referral_timeline, missing_management_steps, "
            "missing_urgent_triggers, retrieval_failed, severity_mismatch"
        ),
        expected_output=(
            "A raw JSON object with keys: verdict (pass/fail), "
            "failed_checks (list of strings), revision_instruction (string)."
        ),
        agent=brief_critic,
        context=[research_task],
    )
