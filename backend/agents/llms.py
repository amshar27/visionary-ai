"""Per-agent LLM instances. Kept separate so each agent's hyperparameters
can be tuned independently of the other."""
import os

from crewai import LLM

researcher_llm = LLM(
    model="gpt-4o-mini",
    temperature=0.1,
    max_tokens=1000,
    api_key=os.getenv("OPENAI_API_KEY"),
)

writer_llm = LLM(
    model="gpt-4o",
    temperature=0.3,
    max_tokens=4000,
    api_key=os.getenv("OPENAI_API_KEY"),
)
