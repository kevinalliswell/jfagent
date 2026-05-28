# Backend API Skeleton

This directory contains the first SaaS-oriented API boundary for JF Agent.

## Commands

Build the backend:

```bash
npm run api:build
```

Run smoke tests:

```bash
npm run api:smoke
```

Start the API server after building:

```bash
npm run api:start
```

Default local URL:

```text
http://localhost:3000
```

Override the port:

```bash
PORT=3100 npm run api:start
```

## Endpoints

- `GET /api/health`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{project_id}`
- `GET /api/session?session_id=<id>`
- `POST /api/session/chat`
- `POST /api/session/override`
- `GET /api/session/export`
- `GET /api/admin/knowledge/status`
- `POST /api/admin/knowledge/upload`

The implementation is intentionally lightweight:

- Node.js built-in HTTP server.
- TypeScript types local to `server/`.
- In-memory session store.
- In-memory project store and project/session binding.
- Mock extraction/risk/export behavior that follows `api_spec.md` envelopes.
- `ExportPayloadV1` builder for Word rendering input.
- First-pass DOCX renderer using `scripts/render-export-docx.py`.
- In-memory rendered asset registry served by `GET /api/assets/{asset_id}/download`.
- Admin-only seed-trial knowledge upload when protected by Nginx Basic Auth.
- Runtime retrieval index reload from `server/generatedKnowledge.json`.

## Current Boundary

The frontend calls through `src/sessionApi.ts`. Default mode still uses `src/mockApi.ts` for stable local demos, and backend mode sends selected session calls to this API skeleton.

In backend mode, `POST /api/session/chat` can bind a session to a project by sending `project_id`; later chat requests must keep using the same project id, and the export payload will prefer the bound project record when it exists.

`GET /api/session?session_id=<id>` returns a read-only snapshot under `data` with both the session record and the bound project summary, if any. Unknown session ids return `404 SESSION_NOT_FOUND`.

To run the frontend against this backend skeleton:

```bash
npm run api:build
npm run api:start
```

In another terminal:

```bash
npm run dev:backend
```

For seed deployment, build the frontend with same-origin API calls:

```bash
VITE_SESSION_API_MODE=backend VITE_API_BASE_URL=same-origin npm run build
```

Then protect `/api/admin/` at the reverse proxy layer before exposing the upload endpoint.
