# Project Documentation Guidelines

Use canonical docs for durable truth:

- `docs/DOCUMENTATION-MAP.md` for navigation
- `docs/system/SDD.md` for architecture and product design
- `docs/system/use-cases.md` for scenarios
- `docs/system/authorization-matrix.md` for permissions
- `docs/adr/` for major architecture decisions
- `docs/features/` for active feature plans

Use stable IDs for durable facts:

- `ADR-PROF-0003`
- `REQ-HIRING-001`
- `AC-HIRING-001`
- `TASK-HIRING-001`
- `NFR-SEC-001`

Do not rely on only `ADR 0003`, `Q1`, `P1`, or `IQ-6`. These may be aliases,
but every durable requirement, decision, task, or acceptance criterion should
have a canonical stable ID.

Legacy ADR headings and filenames are supported for visibility. For example,
`# ADR 0003: Hybrid Search Architecture` and `docs/adr/0003-hybrid-search-architecture.md`
can be indexed as `ADR-PROF-0003` when `ids.project_domain: PROF`.

Do not create Markdown changelogs by default. Instead:

- update canonical docs when behavior changes
- call `remember_implementation_summary` after completed work
- call `remember_decision` for durable decisions
- call `remember_requirement_change` when requirements change
- call `remember_review` for review findings

Create a Markdown changelog only when the user explicitly asks for a
human-readable release or audit artifact. Historical changelogs should remain
indexed as legacy context, but they are not required platform state.
