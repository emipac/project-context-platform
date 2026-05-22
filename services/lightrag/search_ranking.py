from __future__ import annotations

from typing import Any, TypeVar

T = TypeVar("T")


def _source_path(item: Any) -> str:
    if isinstance(item, dict):
        return str(item.get("source_path", ""))
    return str(getattr(item, "source_path", ""))


def apply_source_diversity_cap(
    ranked: list[T],
    limit: int,
    max_per_source_path: int = 2,
) -> list[T]:
    if limit <= 0:
        return []
    first_pass: list[T] = []
    picked: set[int] = set()
    counts: dict[str, int] = {}

    for i, item in enumerate(ranked):
        if len(first_pass) >= limit:
            break
        path = _source_path(item)
        seen = counts.get(path, 0)
        if seen >= max_per_source_path:
            continue
        counts[path] = seen + 1
        first_pass.append(item)
        picked.add(i)

    if len(first_pass) >= limit:
        return first_pass

    out = list(first_pass)
    for i, item in enumerate(ranked):
        if len(out) >= limit:
            break
        if i in picked:
            continue
        out.append(item)
        picked.add(i)
    return out
