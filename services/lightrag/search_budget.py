"""Search budget validation shared by FastAPI routes and tests."""

from __future__ import annotations

from typing import Any

from config import LightRagSettings


def validate_search_budget_limits(
    settings: LightRagSettings,
    *,
    limit: int,
    top_k: int | None,
    chunk_top_k: int | None,
    max_total_tokens: int | None,
    timeout_ms: int | None = None,
) -> dict[str, Any] | None:
    if limit < 1 or limit > 500:
        return {
            "code": "VALIDATION_ERROR",
            "message": "limit must be between 1 and 500.",
            "details": {},
            "project_id": None,
            "retryable": False,
        }
    if top_k is not None:
        if top_k < 1 or top_k > settings.top_k:
            return {
                "code": "VALIDATION_ERROR",
                "message": f"top_k must be between 1 and {settings.top_k}.",
                "details": {},
                "project_id": None,
                "retryable": False,
            }
    if chunk_top_k is not None:
        if chunk_top_k < 1 or chunk_top_k > settings.chunk_top_k:
            return {
                "code": "VALIDATION_ERROR",
                "message": f"chunk_top_k must be between 1 and {settings.chunk_top_k}.",
                "details": {},
                "project_id": None,
                "retryable": False,
            }
    if max_total_tokens is not None:
        if max_total_tokens < 1000 or max_total_tokens > settings.max_total_tokens:
            return {
                "code": "VALIDATION_ERROR",
                "message": f"max_total_tokens must be between 1000 and {settings.max_total_tokens}.",
                "details": {},
                "project_id": None,
                "retryable": False,
            }
    if timeout_ms is not None:
        if timeout_ms < 100 or timeout_ms > 120000:
            return {
                "code": "VALIDATION_ERROR",
                "message": "timeout_ms must be between 100 and 120000.",
                "details": {},
                "project_id": None,
                "retryable": False,
            }
    return None
