# Domain Docs

How the engineering skills should consume this repository’s domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- `CONTEXT-MAP.md` if it exists; it points to context-specific documentation.
- Relevant ADRs under `docs/adr/`.
- In a future multi-context layout, also inspect context-specific `src/<context>/docs/adr/` directories.

If these files do not exist, proceed silently. Do not create empty domain documentation merely to satisfy the layout. `/domain-modeling`, usually reached through `/grill-with-docs`, creates and updates them when terminology or architectural decisions are actually resolved.

## File structure

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-example-decision.md
│       └── 0002-another-decision.md
└── src/
```

## Use the glossary’s vocabulary

When an issue, specification, test, or implementation names a domain concept, use the term defined in `CONTEXT.md`.

Do not silently introduce synonyms for established concepts. If a required concept is missing, either reconsider the terminology or record the gap for `/domain-modeling`.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it:

> Contradicts ADR-0007 — but may be worth reopening because…
