"""C3PA Explorer - FastAPI backend.

Serves a normalized SQLite DB (see backend/db.py / backend/ingest.py) over a simple
JSON API consumed by the vanilla SPA in frontend/.
"""

import os

from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from backend.api.annotations import router as annotations_router
from backend.api.documents import router as documents_router
from backend.api.export import router as export_router
from backend.api.search import router as search_router
from backend.api.stats import router as stats_router
from backend.api.units import router as units_router
from backend.core.config import FRONTEND_DIR

app = FastAPI(title="C3PA Explorer", version="0.2.0")

# Register domain API routers
app.include_router(stats_router)
app.include_router(documents_router)
app.include_router(annotations_router)
app.include_router(units_router)
app.include_router(export_router)
app.include_router(search_router)

# Mount frontend SPA files under both /frontend and /static for compatibility
app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR), name="frontend")
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)