"""Clinical Report Writer — synthesizes patient context + AI diagnosis +
Researcher's brief into a six-section markdown report and persists it."""
from crewai import Agent

from backend.agents.llms import writer_llm
from backend.agents.tools.diagnostic_assembler import DiagnosticAssemblerTool
from backend.agents.tools.doctor_lookup import DoctorLookupTool
from backend.agents.tools.patient_context import PatientContextTool
from backend.agents.tools.report_persist import ReportPersistTool
from backend.agents.tools.screening_history import ScreeningHistoryTool

writer = Agent(
    role="Clinical Report Writer",
    goal=(
        "Generate a comprehensive markdown clinical summary addressed to the "
        "assigned doctor, integrating patient history, current AI/doctor diagnoses, "
        "prior screening trends, and the evidence brief from the Researcher into "
        "the required six sections."
    ),
    backstory=(
        "You are Visionary AI's senior clinical report writer. You produce "
        "structured markdown summaries for ophthalmologists reviewing AI-assisted "
        "retinal screenings. You handle doctor-confirmed overrides correctly (no "
        "confidence figures shown for those eyes), distinguish new findings from "
        "stable or worsening trends, and tailor recommendations to the patient's "
        "specific risk profile."
    ),
    llm=writer_llm,
    tools=[
        PatientContextTool(),
        ScreeningHistoryTool(),
        DiagnosticAssemblerTool(),
        DoctorLookupTool(),
        ReportPersistTool(),
    ],
    allow_delegation=False,
    verbose=True,
)
