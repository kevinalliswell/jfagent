# Future & Aspirational Specs — Registry

> STATUS: GOVERNANCE INDEX. The large root specs listed below are mostly
> **FUTURE / aspirational design**, not current behavior. They were drifting
> into being read as if implemented, which sent agents off building against
> contracts the code does not have. This registry records, per spec, how much is
> actually wired today so no one mistakes design for reality.
>
> The files physically remain at the repo root because three of them
> (`rules.md`, `knowledge_base.md`, `templates.md`) are also INGESTED as
> knowledge-base seeds by `scripts/build-knowledge-index.mjs` and COPYed by the
> Docker image. Physically relocating them would change the generated knowledge
> index and the image build, which conflicts with the current Stabilize phase.
> A clean follow-up (extract design specs out of RAG ingestion, then move them
> here) is tracked in `docs/tasks.md`.

Each spec file carries a STATUS banner at its top. Read the banner first.

## Registry

| Spec | Lines | Status | What is actually built today | Treat as |
| ---- | ----- | ------ | ---------------------------- | -------- |
| `api_spec.md` | ~1645 | PARTIAL | Routes/envelopes exist (`server/http.ts`); request/response schema validation is loose; payment is willingness-only and hardcoded. | Reference for intent; verify each contract against `server/http.ts` before relying on it. |
| `rules.md` | ~1052 | FUTURE | Real engine triggers ~2 hardcoded risks (floor-loading, elevator/rack) in `server/sessionService.ts`. No multi-tier P0–P3 engine, no data-driven rules, no remediation workflow. | Backlog design. Do not assume any rule beyond what the code triggers. |
| `knowledge_base.md` | ~1237 | FUTURE | Real RAG = local hashed vectors (`local-hash-v1`, 96-dim) + naive keyword + hybrid sort. No BM25, no embedding model, no vector DB, no live upload→embed pipeline beyond index rebuild. | Backlog design for the eventual RAG service. |
| `templates.md` | ~965 | PARTIAL | First-pass `python-docx` renderer covers a fixed chapter set (`server/exportPayload.ts` + `scripts/render-export-docx.py`). Visual/layout QA needs LibreOffice/`soffice` (not installed locally). | Reference for chapter structure; the renderer is first-pass, not full-fidelity. |

## Rule for agents

Before building against anything in these specs:

1. Check the STATUS banner.
2. Grep the code (`src/`, `server/`) to confirm what is actually wired.
3. Confirm the work serves the current `GOAL.md` objective.

If it is FUTURE and not in `GOAL.md`, it is out of scope — log it, do not build it.
