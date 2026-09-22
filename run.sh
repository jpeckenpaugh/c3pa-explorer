#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -d ".venv" ]; then
    echo "Error: .venv not found. Run: python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt"
    exit 1
fi

PORT="${PORT:-8765}"
echo "C3PA Explorer on http://localhost:$PORT"
exec .venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port "$PORT" --reload "$@"