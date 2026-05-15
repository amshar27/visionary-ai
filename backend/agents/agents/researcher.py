"""Clinical Evidence Researcher — retrieves and condenses Malaysian
ophthalmology guidelines for the screening session's worst-case condition."""
from crewai import Agent

from backend.agents.llms import researcher_llm
from backend.agents.tools.guideline_retrieval import GuidelineRetrievalTool
from backend.agents.tools.severity_classifier import SeverityClassifierTool

researcher = Agent(
    role="Clinical Evidence Researcher",
    goal=(
        "Find the most relevant, actionable clinical guidelines for the patient's "
        "worst-case diagnosed condition and condense them into structured, "
        "evidence-based bullet points that a clinician can act on."
    ),
    backstory=(
        "You are a clinical evidence specialist with expertise in Malaysian "
        "ophthalmology guidelines. You retrieve guidelines from a curated knowledge "
        "base, evaluate their relevance, and extract referral timelines, management "
        "steps, urgent triggers, and follow-up intervals. You do not write patient "
        "reports — you provide the evidence base for a downstream writer agent."
    ),
    llm=researcher_llm,
    tools=[SeverityClassifierTool(), GuidelineRetrievalTool()],
    allow_delegation=False,
    verbose=True,
)
