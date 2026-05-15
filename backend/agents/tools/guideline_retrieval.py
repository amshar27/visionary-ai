"""Embeds a query and pulls top-k guideline chunks from the Supabase vector
store via the `match_documents` RPC."""
import logging
from typing import Type

from crewai.tools import BaseTool
from langchain_openai import OpenAIEmbeddings
from pydantic import BaseModel, Field

from backend.db import supabase

logger = logging.getLogger(__name__)

# Reuse the same model the rest of the pipeline uses.
_embeddings = OpenAIEmbeddings(model="text-embedding-3-small")


class GuidelineRetrievalInput(BaseModel):
    search_query: str = Field(
        ..., description="Natural-language guideline search query"
    )


class GuidelineRetrievalTool(BaseTool):
    name: str = "guideline_retrieval"
    description: str = (
        "Retrieves up to 5 relevant guideline chunks from the Malaysian "
        "ophthalmology knowledge base for the given search query. "
        "Output: {retrieved_docs: [{source, content}], sources: [filenames], note?}."
    )
    args_schema: Type[BaseModel] = GuidelineRetrievalInput

    def _run(self, search_query: str) -> dict:
        try:
            query_vector = _embeddings.embed_query(search_query)
        except Exception as e:
            logger.error(f"Embedding failed for query '{search_query}': {e}")
            return {
                "retrieved_docs": [],
                "sources": [],
                "note": f"Embedding failed: {e}",
            }

        try:
            rpc_response = supabase.rpc(
                "match_documents",
                {
                    "query_embedding": query_vector,
                    "match_threshold": 0.45,
                    "match_count": 5,
                },
            ).execute()
        except Exception as e:
            logger.error(f"match_documents RPC failed: {e}")
            return {
                "retrieved_docs": [],
                "sources": [],
                "note": f"match_documents RPC failed: {e}",
            }

        retrieved = rpc_response.data or []
        if not retrieved:
            return {
                "retrieved_docs": [],
                "sources": [],
                "note": "No specific local guidelines found in database.",
            }

        docs = []
        sources_set = set()
        for d in retrieved:
            source = (d.get("metadata") or {}).get("source", "Guidelines")
            content = d.get("content", "")
            docs.append({"source": source, "content": content})
            sources_set.add(source)

        return {"retrieved_docs": docs, "sources": sorted(sources_set)}
