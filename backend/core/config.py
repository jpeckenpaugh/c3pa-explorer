import os

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(BACKEND_DIR)
FRONTEND_DIR = os.path.join(ROOT, "frontend")
STATIC_DIR = FRONTEND_DIR
