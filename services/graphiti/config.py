from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class GraphitiSettings:
    backend: str
    data_dir: Path
    neo4j_uri: str | None
    neo4j_user: str | None
    neo4j_password: str | None
    llm_provider: str
    llm_model: str
    small_llm_model: str
    embedding_model: str
    concurrency_limit: int
    openai_api_key: str | None
    openai_base_url: str | None


def load_settings() -> GraphitiSettings:
    backend = normalized_choice(os.environ.get("GRAPHITI_BACKEND", "contract"), {"contract", "core"}, "contract")
    return GraphitiSettings(
        backend=backend,
        data_dir=Path(os.environ.get("GRAPHITI_DATA_DIR", "/data")),
        neo4j_uri=os.environ.get("NEO4J_URI") or None,
        neo4j_user=os.environ.get("NEO4J_USER") or None,
        neo4j_password=os.environ.get("NEO4J_PASSWORD") or None,
        llm_provider=os.environ.get("GRAPHITI_LLM_PROVIDER", "openai"),
        llm_model=os.environ.get("GRAPHITI_LLM_MODEL", "gpt-4o-mini"),
        small_llm_model=os.environ.get("GRAPHITI_SMALL_LLM_MODEL", "gpt-4o-mini"),
        embedding_model=os.environ.get("GRAPHITI_EMBEDDING_MODEL", "text-embedding-3-small"),
        concurrency_limit=positive_int(os.environ.get("GRAPHITI_CONCURRENCY_LIMIT"), 2),
        openai_api_key=os.environ.get("OPENAI_API_KEY") or None,
        openai_base_url=os.environ.get("GRAPHITI_OPENAI_BASE_URL") or None,
    )


def validate_core_ready(settings: GraphitiSettings) -> list[str]:
    missing: list[str] = []
    if settings.backend != "core":
        return missing
    if not settings.neo4j_uri:
        missing.append("NEO4J_URI")
    if not settings.neo4j_user:
        missing.append("NEO4J_USER")
    if not settings.neo4j_password:
        missing.append("NEO4J_PASSWORD")
    if settings.llm_provider in {"openai", "openai-compatible"} and not settings.openai_api_key:
        missing.append("OPENAI_API_KEY")
    if not settings.llm_model:
        missing.append("GRAPHITI_LLM_MODEL")
    if not settings.embedding_model:
        missing.append("GRAPHITI_EMBEDDING_MODEL")
    return missing


def normalized_choice(value: str, allowed: set[str], fallback: str) -> str:
    normalized = value.strip().lower()
    return normalized if normalized in allowed else fallback


def positive_int(value: str | None, fallback: int) -> int:
    if value is None or value == "":
        return fallback
    try:
        parsed = int(value)
    except ValueError:
        return fallback
    return parsed if parsed > 0 else fallback
