#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"

# Local runs use the install.sh virtualenv by default. CI (and anyone with a
# pre-provisioned interpreter) can override with PYTHON=/path/to/python.
if [ -n "${PYTHON:-}" ]; then
    PYTHON_BIN="$PYTHON"
else
    PYTHON_BIN=".venv/bin/python"
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    if [ -n "${PYTHON:-}" ]; then
        echo "Error: PYTHON=$PYTHON_BIN is not executable."
    else
        echo "Error: .venv not found. Run ./install.sh first (or set PYTHON=...)."
    fi
    exit 1
fi

# In CI the fixture DB is a hard dependency: fail here instead of letting the
# fixture generator skip and silently dropping the parity evidence.
if [ -n "${CI:-}${GITHUB_ACTIONS:-}" ]; then
    DB_PATH="${C3PA_DB_PATH:-data/explorer.db}"
    if [ ! -f "$DB_PATH" ]; then
        echo "Error: CI fixture database not found at $DB_PATH."
        echo "Build it first: python tests/make_fixture_db.py --out data/explorer.db"
        exit 1
    fi
fi

echo "=== Running C3PA Explorer Test Suite ==="

echo "--- Python Backend API Tests ---"
PYTHONPATH=. "$PYTHON_BIN" -m unittest discover -s tests -p "test_*.py" -v

echo "--- Colab Notebook Source Sync Check ---"
"$PYTHON_BIN" scripts/check_notebook_sync.py

echo "--- Browser Parity: FastAPI Fixture Generator ---"
PYTHONPATH=. "$PYTHON_BIN" tests/gen_fastapi_fixtures.py

echo "--- JS Frontend Unit Tests ---"
node --test tests/frontend/*.test.js

echo "--- JS Browser Edition Parity Tests ---"
node --test tests/jbrowser_parity.test.js

echo "--- JS Browser Edition Bridge (Phase 2) Tests ---"
node --test tests/jbrowser_bridge.test.js

echo "--- JS Browser Edition Snapshot Archive (tar.gz) Tests ---"
node --test tests/jbrowser_targz.test.js

echo "--- JS Browser Edition Published Snapshot Tests ---"
node --test tests/jbrowser_published.test.js

echo "--- JS Browser Edition Export Port Tests ---"
node --test tests/jbrowser_export.test.js
