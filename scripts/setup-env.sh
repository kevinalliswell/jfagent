#!/usr/bin/env bash
# Idempotent environment bootstrap for jfagent.
#
# Goal: make a fresh container (Codex web session, CI, or a new laptop) reach a
# GREEN `npm run check` without manual steps. The most common "phantom failure"
# is the formal-export smoke step returning 500 because python-docx is missing.
#
# Safe to run repeatedly. Designed to be wired into:
#   - a Codex environment setup script, and
#   - the Claude Code SessionStart hook (.claude/settings.json).

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "[setup-env] repo: ${ROOT}"

# --- Node dependencies -------------------------------------------------------
if [ ! -d node_modules ]; then
  echo "[setup-env] installing node dependencies (npm install)…"
  npm install --no-audit --no-fund
else
  echo "[setup-env] node_modules present, skipping npm install"
fi

# --- Python dependencies (knowledge ingestion + DOCX export) -----------------
PY="${PYTHON_BIN:-${PYTHON:-python3}}"
if command -v "$PY" >/dev/null 2>&1; then
  if "$PY" -c "import docx, openpyxl" >/dev/null 2>&1; then
    echo "[setup-env] python deps already satisfied (docx, openpyxl)"
  else
    echo "[setup-env] installing python deps from requirements.txt…"
    "$PY" -m pip install --quiet --disable-pip-version-check -r requirements.txt \
      || echo "[setup-env] WARN: pip install failed (offline?). DOCX export / kb:build may fail until deps are installed."
  fi
else
  echo "[setup-env] WARN: python3 not found; document ingestion and DOCX export will fail."
fi

echo "[setup-env] done. Verify with: npm run check"
