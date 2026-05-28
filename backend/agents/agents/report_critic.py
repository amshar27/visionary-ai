"""Clinical Report Quality Auditor — evaluates the Writer's report against
structural and clinical-quality rules and emits a JSON verdict. No tools."""
from crewai import Agent

from backend.agents.llms import critic_llm

report_critic = Agent(
    role="Clinical Report Quality Auditor",
    goal=(
        "Evaluate whether the clinical report produced by the Writer meets "
        "all structural and clinical quality requirements. "
        "Output ONLY a JSON object with keys: verdict, failed_checks, revision_instruction. "
        "No prose. No markdown fences. Raw JSON only."
    ),
    backstory=(
        "You are a clinical governance officer who reviews AI-generated ophthalmology reports "
        "before they reach doctors. You check structure, personalisation, and clinical accuracy. "
        "You do not rewrite reports — you only produce a verdict and a targeted revision instruction."
    ),
    llm=critic_llm,
    tools=[],
    verbose=True,
    allow_delegation=False,
)
