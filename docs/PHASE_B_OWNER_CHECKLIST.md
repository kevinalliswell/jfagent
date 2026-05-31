# Phase B — Owner Checklist

Phase B (the small paid pilot, D-020) cannot be driven by Codex alone: most of it
is gated on real-world resources only the owner can provide. This is your action
list. Codex handles all coding; you provide resources, make decisions, and judge
quality. Pair this with the Codex coding tasks in `docs/tasks.md` (T-035, T-036).

Division of labor: **Codex = developer. Owner = direction, resources, acceptance.**

---

## 0. Decision first: how do the deploy images get built?

The seed stack runs prebuilt GHCR images, published by GitHub Actions **on push
to `main`** (`.github/workflows/docker-publish.yml`). Current work lives on
`claude/stoic-cori-FwD18`. So before T-031 you must decide:

- [ ] Merge `claude/stoic-cori-FwD18` → `main` (or open a PR and merge) so the
      `jfagent-api` / `jfagent-web` images publish. (Tell me if you want a PR —
      I will not open one without your go-ahead.)

---

## 1. Deploy the seed stack (unblocks T-031)

Provide / prepare:

- [ ] **A server**: Ubuntu 22.04/24.04 or Debian 12, with Docker + Compose v2,
      ports 80/443 open. (SSH access for whoever runs the deploy.)
- [ ] **A domain**: an A record pointing at the server IP (Caddy auto-issues HTTPS).
- [ ] **A GitHub token** with `read:packages` (to pull the private GHCR images).
- [ ] **Two passwords** (seed user + admin). Generate bcrypt hashes:
      ```bash
      docker run --rm caddy:2-alpine caddy hash-password --plaintext 'SEED_PASSWORD'
      docker run --rm caddy:2-alpine caddy hash-password --plaintext 'ADMIN_PASSWORD'
      ```
      → put into `.env.caddy` (`DOMAIN`, `SEED_BASIC_AUTH_*`, `ADMIN_BASIC_AUTH_*`).
- [ ] **Optional real-AI creds** (to get `真实模型` instead of fallback): an
      OpenAI-compatible key. → `.env.api`: `OPENAI_BASE_URL` (e.g.
      `https://xingwan.store/v1`), `OPENAI_API_KEY`, `OPENAI_MODEL`.

Then follow `docs/deployment.md` (copy only `compose.seed.yml` + `.env.caddy`
[+ `.env.api`] to the server; `docker login ghcr.io`; `compose pull && up -d`).
For a Codex CLI doing the deploy on the VPS, hand it `docs/vps-codex-deployment-handoff.md`.

Acceptance (T-031 done): `curl -u seeduser:… https://DOMAIN/api/health` is 200, the
V2 first screen shows completeness / risk / evidence / delivery, and the runtime
banner correctly reads `真实模型` vs fallback.

## 2. Seed the knowledge base (unblocks T-032)

- [ ] Collect **10–20 cleaned, desensitized internal docs**: past requirement
      sheets, quotations/BOQ (`.xlsx/.csv`), case write-ups, device specs
      (`.md/.txt/.docx/.pdf`). Remove anything customer-confidential you are not
      comfortable hosting on the seed server.
- [ ] Upload them via `https://DOMAIN/?admin=1` (admin Basic Auth), then start a
      chat turn and confirm they show up in knowledge citations.

## 3. Run real pilot projects (unblocks T-033 / T-034)

- [ ] **3–5 real project descriptions** (messy WeChat-style is fine) to run
      through cockpit → chat → export. Judge: does it cut back-and-forth vs the
      old chat MVP?
- [ ] **1 real external sample customer / project** to produce a requirement
      sheet end-to-end. Judge: is the generated sheet good enough to hand over?

---

## What you give me / Codex, and what comes back

| You provide | Codex/Claude returns |
| ----------- | -------------------- |
| Go-ahead to publish images (merge/PR) | (Claude) PR on request; never without your word |
| Server + domain + GHCR token + Caddy hashes + OpenAI creds | (Codex) preflight + verified deploy runbook |
| 10–20 internal docs | (Codex) ingestion/citation verification |
| 3–5 project descriptions + 1 customer | (Codex) export/template fixes if the sheet needs them |
| "fix reliability first" | (Codex) T-036 mock/backend drift reconciliation |

The ready-to-paste Codex prompts for the coding tasks live in
`docs/GOAL_MODE_PROMPT.md` (§ Task kickoff prompts).
