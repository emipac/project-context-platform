from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LightRagSettings:
    backend: str
    data_dir: Path
    llm_provider: str
    llm_model: str
    embedding_model: str
    embedding_dim: int
    embedding_max_token_size: int
    query_mode: str
    openai_api_key: str | None
    openai_base_url: str | None
    max_async: int
    max_parallel_insert: int
    top_k: int
    chunk_top_k: int
    max_total_tokens: int
    search_timeout_ms: int


def load_settings() -> LightRagSettings:
    backend = normalized_choice(os.environ.get("LIGHTRAG_BACKEND", "contract"), {"contract", "core"}, "contract")
    query_mode = normalized_choice(os.environ.get("LIGHTRAG_QUERY_MODE", "hybrid"), {"mix", "hybrid", "local", "global", "naive"}, "hybrid")
    return LightRagSettings(
        backend=backend,
        data_dir=Path(os.environ.get("LIGHTRAG_DATA_DIR", "/data")),
        llm_provider=os.environ.get("LIGHTRAG_LLM_PROVIDER", "openai"),
        llm_model=os.environ.get("LIGHTRAG_LLM_MODEL", "gpt-4o-mini"),
        embedding_model=os.environ.get("LIGHTRAG_EMBEDDING_MODEL", "text-embedding-3-small"),
        embedding_dim=positive_int(os.environ.get("LIGHTRAG_EMBEDDING_DIM"), 1536),
        embedding_max_token_size=positive_int(os.environ.get("LIGHTRAG_EMBEDDING_MAX_TOKEN_SIZE"), 8192),
        query_mode=query_mode,
        openai_api_key=os.environ.get("OPENAI_API_KEY") or None,
        openai_base_url=os.environ.get("LIGHTRAG_OPENAI_BASE_URL") or None,
        max_async=bounded_int(os.environ.get("LIGHTRAG_MAX_ASYNC"), fallback=4, minimum=1, maximum=32),
        max_parallel_insert=bounded_int(os.environ.get("LIGHTRAG_MAX_PARALLEL_INSERT"), fallback=2, minimum=1, maximum=10),
        top_k=bounded_int(os.environ.get("LIGHTRAG_TOP_K"), fallback=40, minimum=1, maximum=200),
        chunk_top_k=bounded_int(os.environ.get("LIGHTRAG_CHUNK_TOP_K"), fallback=16, minimum=1, maximum=100),
        max_total_tokens=bounded_int(os.environ.get("LIGHTRAG_MAX_TOTAL_TOKENS"), fallback=20000, minimum=1000, maximum=100000),
        search_timeout_ms=bounded_int(os.environ.get("LIGHTRAG_SEARCH_TIMEOUT_MS"), fallback=15000, minimum=100, maximum=120000),
    )


def validate_core_ready(settings: LightRagSettings) -> list[str]:
    missing: list[str] = []
    if settings.backend != "core":
        return missing
    if settings.llm_provider in {"openai", "openai-compatible"} and not settings.openai_api_key:
        missing.append("OPENAI_API_KEY")
    if not settings.llm_model:
        missing.append("LIGHTRAG_LLM_MODEL")
    if not settings.embedding_model:
        missing.append("LIGHTRAG_EMBEDDING_MODEL")
    if settings.embedding_dim <= 0:
        missing.append("LIGHTRAG_EMBEDDING_DIM")
    return missing


def normalized_choice(value: str | None, allowed: set[str], fallback: str) -> str:
    if value is None:
        return fallback
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


def bounded_int(value: str | None, fallback: int, minimum: int, maximum: int) -> int:
    parsed = positive_int(value, fallback)
    return max(minimum, min(maximum, parsed))
