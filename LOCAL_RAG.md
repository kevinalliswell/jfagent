# Local RAG MVP

This project currently uses a lightweight local knowledge index for the pre-sales demo.

## Add Knowledge

Put internal knowledge files under:

```text
knowledge/
```

Supported extensions:

- `.md`
- `.txt`
- `.docx`
- `.pdf`
- `.xlsx`
- `.csv`
- `.tsv`

Good first files:

- Historical machine room proposals.
- UPS and battery sizing notes.
- Precision AC selection notes.
- Data center room construction scope templates.
- Sales clarification scripts.

## Rebuild Index

Run:

```bash
npm run kb:build
```

The script reads `knowledge/**/*.md`, `knowledge/**/*.txt`, `knowledge/**/*.docx`, `knowledge/**/*.pdf`, `knowledge/**/*.xlsx`, `knowledge/**/*.csv`, `knowledge/**/*.tsv`, and the existing seed files:

- `knowledge_base.md`
- `rules.md`
- `templates.md`

It generates:

```text
src/generatedKnowledge.ts
server/generatedKnowledge.ts
server/generatedKnowledge.json
```

Mock mode imports `src/generatedKnowledge.ts` and performs local hybrid keyword/vector retrieval in the browser. Backend mode loads `server/generatedKnowledge.json` at runtime; `/api/session/chat` performs retrieval in the API layer and returns `knowledge_hits` to the frontend.

For seed trials, an administrator can open `/?admin=1` in backend mode and upload supported files through the UI. Uploaded files are stored under `knowledge/uploads/`, `npm run kb:build` is triggered automatically, and backend retrieval hot-reloads the runtime index.

The current local vector mode is:

- Model label: `local-hash-v1`
- Dimensions: `96`
- Privacy: fully local; no external embedding API
- Verification: `npm run kb:verify`

## Current Scope

Supported now:

- Markdown, TXT, DOCX, PDF, XLSX, CSV, and TSV ingestion.
- Quotation/BOQ row extraction with equipment category hints.
- Heading-aware chunking.
- Source file metadata.
- Local hashed vector generation.
- Local hybrid keyword/vector retrieval in frontend mock mode and backend API mode.
- Admin-only UI upload for seed-trial knowledge refresh in backend mode.
- Knowledge hit display in the right panel.
- Quotation/BOQ summary display in the right panel.
- Payment-intent gate for formal Word export.

Not implemented yet:

- Legacy `.xls` parsing.
- Real semantic embedding models.
- Persistent vector database.
- Application-level permission control beyond Nginx Basic Auth.

## Next Upgrade Path

The next practical step is to add retrieval audit metadata and a provider abstraction, then replace `local-hash-v1` with a real local or managed embedding model plus a local vector store such as Chroma, Qdrant, or PostgreSQL/pgvector.
