"""Report Critic's task: audit the Writer's six-section report and emit a
JSON verdict (verdict / failed_checks / revision_instruction)."""
from crewai import Task

from backend.agents.agents.report_critic import report_critic


def build_report_critique_task(report_task) -> Task:
    return Task(
        description=(
            "Review the six-section clinical report produced by the Clinical Report Writer. "
            "Apply the following rubric and output a JSON verdict.\n\n"
            "RUBRIC — mark as fail if ANY of these are true:\n"
            "1. Any of the six required sections is absent or empty\n"
            "2. No patient-specific risk factor is named anywhere in the report\n"
            "3. The follow-up interval stated in the report does not match the severity classification\n"
            "4. No PDF or guideline reference is cited anywhere in the report\n"
            "5. Recommendations are entirely generic — no mention of the specific condition or severity\n\n"
            "Output format — raw JSON, no fences, no prose:\n"
            "{\n"
            '  "verdict": "pass" or "fail",\n'
            '  "failed_checks": ["missing_section", ...],\n'
            '  "revision_instruction": "one actionable sentence for the Writer, or empty string if pass"\n'
            "}\n\n"
            "Valid failed_check values: missing_section, no_risk_factor_linkage, "
            "followup_interval_mismatch, no_references_cited, generic_recommendations"
        ),
        expected_output=(
            "A raw JSON object with keys: verdict (pass/fail), "
            "failed_checks (list of strings), revision_instruction (string)."
        ),
        agent=report_critic,
        context=[report_task],
    )
