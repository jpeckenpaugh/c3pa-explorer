#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -d ".venv" ]; then
    echo "Error: .venv not found. Run ./install.sh first."
    exit 1
fi

echo "=== Running C3PA Explorer Test Suite ==="

echo "--- Python Backend API Tests ---"
PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -p "test_*.py" -v

echo "--- Browser Parity: FastAPI Fixture Generator ---"
PYTHONPATH=. .venv/bin/python tests/gen_fastapi_fixtures.py

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
