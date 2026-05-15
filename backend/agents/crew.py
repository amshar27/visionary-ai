"""Crew factory: assembles the Researcher + Writer pipeline and runs it
sequentially. The Writer receives the Researcher's brief via task context."""
from crewai import Crew, Process

from backend.agents.tasks.report_task import build_report_task
from backend.agents.tasks.research_task import build_research_task


def run_clinical_report_crew(screening_session_id: str):
    """Run the two-agent clinical report pipeline.

    Returns the CrewAI CrewOutput. Caller is responsible for extracting `.raw`
    and parsing it as JSON per the writer task's expected_output contract.
    """
    research_task = build_research_task(screening_session_id)
    report_task = build_report_task(screening_session_id, research_task)

    crew = Crew(
        tasks=[research_task, report_task],
        process=Process.sequential,
        verbose=True,
    )

    return crew.kickoff()
