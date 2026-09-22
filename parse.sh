#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -d ".venv" ]; then
    echo "Error: .venv not found. Run: python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt"
    exit 1
fi

exec .venv/bin/python -m backend.ingest "$@"