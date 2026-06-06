"""Crew factory: assembles the four-agent clinical report pipeline."""
import json
import logging
import re

from crewai import Crew, Process

from backend.agents.tasks.brief_critique_task import build_brief_critique_task
from backend.agents.tasks.report_critique_task import build_report_critique_task
from backend.agents.tasks.report_revision_task import build_report_revision_task
from backend.agents.tasks.report_task import build_report_task
from backend.agents.tasks.research_revision_task import build_research_revision_task
from backend.agents.tasks.research_task import build_research_task

logger = logging.getLogger(__name__)


NORMAL_SCREENING_TEMPLATE = """### Routine Screening Result

No diabetic retinopathy, cataract, or glaucoma was detected in this screening.

**Recommendation:** Routine annual review.
"""


def _is_no_dr_session(ai_results_data: list) -> bool:
    """Defensive duplicate of the same helper in ai.py — returns True when
    every eye in the session is 'none' (and no doctor override raised it)."""
    if not ai_results_data:
        return False

    severity_levels = {'none': 0, 'mild': 1, 'moderate': 2, 'severe': 3, 'proliferative': 4}

    for result in ai_results_data:
        severity = (result.get('dr_severity') or result.get('severity_label') or 'none').lower()
        if severity in ('cataract', 'glaucoma'):
            return False
        if severity_levels.get(severity, 0) > 0:
            return False

    return True


def _strip_markdown_fences(text: str) -> str:
    """Strip ```markdown / ```json fences and 'Final Answer:' prefixes."""
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:markdown|md|json)?\s*\n?", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\n?```\s*$", "", cleaned)
    cleaned = re.sub(r"^(final answer|answer)\s*:\s*\n?", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def run_clinical_report_crew(screening_session_id: str) -> dict:
    """Run the four-agent clinical report pipeline.

    Pipeline order:
        Phase 1a — Researcher → Brief Critic (their own Crew). Verdict parsed.
        Phase 1b (conditional, fail-only, at most once) — Researcher revises
            the brief addressing only the flagged checks. report_task is then
            rebuilt so its context points at the revised research task.
        Phase 1c — Writer runs on its own Crew with the (possibly revised)
            report_task. The brief_critique_task is appended to the Writer's
            context so it still sees the critic's verdict.
        Phase 2 — Report Critic audits the Writer's draft and emits a JSON
            verdict.
        Phase 3 (conditional) — if the verdict is "fail", the Writer revises
            the report addressing only the flagged issues.

    A No-DR bypass at the top short-circuits the entire pipeline when every
    eye in the session is classified as 'none' (mirrors the upstream check in
    ai.py so the bypass is honoured even if the crew is invoked directly).

    Returns {"rag_summary": str, "references": list[str]}.
    """

    # ── No-DR bypass ──────────────────────────────────────────────────────────
    try:
        from backend.db import supabase

        ai_res = (
            supabase.table("ai_results")
            .select("*")
            .eq("screening_session_id", str(screening_session_id))
            .execute()
        )
        if ai_res.data and _is_no_dr_session(ai_res.data):
            logger.info(f"No DR bypass triggered for session {screening_session_id} (crew)")
            try:
                supabase.table("ai_results").update(
                    {"rag_summary": NORMAL_SCREENING_TEMPLATE}
                ).eq("screening_session_id", str(screening_session_id)).execute()
            except Exception as save_err:
                logger.warning(f"Failed to persist No DR template: {save_err}")
            return {
                "rag_summary": NORMAL_SCREENING_TEMPLATE,
                "references": [],
            }
    except Exception as bypass_err:
        # Don't let a bypass-check failure block the pipeline — fall through
        # to the full crew and let the Writer/Critic handle the session.
        logger.warning(f"No-DR bypass check failed for {screening_session_id}: {bypass_err}")

    # ── Build initial tasks ───────────────────────────────────────────────────
    research_task = build_research_task(screening_session_id)
    brief_critique_task = build_brief_critique_task(research_task)

    # ── Phase 1a: Researcher → Brief Critic ───────────────────────────────────
    phase1a = Crew(
        tasks=[research_task, brief_critique_task],
        process=Process.sequential,
        verbose=True,
    )
    phase1a.kickoff()

    # Parse the brief critic's verdict (malformed JSON → treated as pass, same
    # defensive pattern used for the report critic below).
    brief_raw = _strip_markdown_fences(brief_critique_task.output.raw or "")
    try:
        brief_verdict = json.loads(brief_raw)
    except json.JSONDecodeError:
        logger.warning(
            f"[brief_critic] session={screening_session_id} "
            f"could not parse verdict JSON, treating as pass. raw={brief_raw[:200]}"
        )
        brief_verdict = {"verdict": "pass", "failed_checks": [], "revision_instruction": ""}

    logger.info(
        f"[brief_critic] session={screening_session_id} "
        f"verdict={brief_verdict.get('verdict')} "
        f"failed_checks={brief_verdict.get('failed_checks', [])}"
    )

    # ── Phase 1b (conditional): Researcher revision ───────────────────────────
    # Loop guard: revise at most once per pipeline invocation. We do NOT
    # re-audit the revised brief (no second Brief Critic run, no loop).
    writer_research_task = research_task
    brief_checks = brief_verdict.get("failed_checks") or []
    brief_should_revise = (
        brief_verdict.get("verdict") == "fail"
        and isinstance(brief_checks, list)
        and len(brief_checks) > 0
    )
    if brief_verdict.get("verdict") == "fail" and not brief_should_revise:
        logger.info(
            f"[brief_critic] session={screening_session_id} "
            f"fail with empty failed_checks treated as pass, no revision triggered"
        )
    if brief_should_revise:
        research_revision_task = build_research_revision_task(
            screening_session_id,
            research_task,
            brief_critique_task,
        )
        phase1b = Crew(
            tasks=[research_revision_task],
            process=Process.sequential,
            verbose=True,
        )
        phase1b.kickoff()
        writer_research_task = research_revision_task

    # Build the Writer's report task against the (possibly revised) brief.
    report_task = build_report_task(screening_session_id, writer_research_task)
    # Thread the brief critique into the Writer's context at runtime so the
    # Writer sees both the brief and the critic's verdict. Doing this here
    # avoids modifying report_task.py.
    try:
        existing_ctx = list(getattr(report_task, "context", []) or [])
        if brief_critique_task not in existing_ctx:
            existing_ctx.append(brief_critique_task)
            report_task.context = existing_ctx
    except Exception as ctx_err:
        logger.warning(f"Could not append brief_critique_task to report_task context: {ctx_err}")

    # ── Phase 1c: Writer ──────────────────────────────────────────────────────
    phase1c = Crew(
        tasks=[report_task],
        process=Process.sequential,
        verbose=True,
    )
    phase1c.kickoff()

    # ── Phase 2: Report Critic ────────────────────────────────────────────────
    report_critique_task = build_report_critique_task(report_task)
    phase2 = Crew(
        tasks=[report_critique_task],
        process=Process.sequential,
        verbose=True,
    )
    phase2.kickoff()

    # ── Parse the report critic's verdict ─────────────────────────────────────
    raw_verdict = _strip_markdown_fences(report_critique_task.output.raw or "")
    try:
        verdict = json.loads(raw_verdict)
    except json.JSONDecodeError:
        logger.warning(
            f"[report_critic] session={screening_session_id} "
            f"could not parse verdict JSON, treating as pass. raw={raw_verdict[:200]}"
        )
        verdict = {"verdict": "pass", "failed_checks": [], "revision_instruction": ""}

    logger.info(
        f"[report_critic] session={screening_session_id} "
        f"verdict={verdict.get('verdict')} "
        f"failed_checks={verdict.get('failed_checks', [])}"
    )

    # ── Phase 3 (conditional): Writer revision ────────────────────────────────
    report_checks = verdict.get("failed_checks") or []
    report_should_revise = (
        verdict.get("verdict") == "fail"
        and isinstance(report_checks, list)
        and len(report_checks) > 0
    )
    if verdict.get("verdict") == "fail" and not report_should_revise:
        logger.info(
            f"[report_critic] session={screening_session_id} "
            f"fail with empty failed_checks treated as pass, no revision triggered"
        )
    if report_should_revise:
        report_revision_task = build_report_revision_task(
            screening_session_id,
            report_task,
            report_critique_task,
        )
        phase3 = Crew(
            tasks=[report_revision_task],
            process=Process.sequential,
            verbose=True,
        )
        phase3.kickoff()
        final_raw = report_revision_task.output.raw or ""
    else:
        final_raw = report_task.output.raw or ""

    # ── Final cleanup + reference extraction ──────────────────────────────────
    final_report = _strip_markdown_fences(final_raw)
    references = sorted(set(re.findall(r"[\w\-\.]+\.pdf", final_report)))

    return {"rag_summary": final_report, "references": references}
