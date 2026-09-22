#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "=== Installing C3PA Explorer ==="

PYTHON_BIN=""
if command -v python3.12 >/dev/null 2>&1; then
    PYTHON_BIN="python3.12"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
else
    echo "Error: Python 3 is required but not installed."
    exit 1
fi

echo "Using Python binary: $PYTHON_BIN ($($PYTHON_BIN --version))"

if [ ! -d ".venv" ]; then
    echo "Creating virtual environment in .venv..."
    $PYTHON_BIN -m venv .venv
fi

echo "Installing/updating dependencies..."
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt

if [ -d ".git" ]; then
    echo "Initializing git submodules..."
    git submodule update --init --recursive || true
fi

echo "Building SQLite database (re-extracting & aligning dataset)..."
.venv/bin/python -m backend.ingest

echo ""
echo "=== Installation complete! ==="
echo "Run test suite: ./tests.sh"
echo "Start server:    ./run.sh"
