"""C3PA Explorer - FastAPI backend.

Serves a normalized SQLite DB (see backend/db.py / backend/ingest.py) over a simple
JSON API consumed by the vanilla SPA in frontend/.
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from backend.api.annotations import router as annotations_router
from backend.api.documents import router as documents_router
from backend.api.export import router as export_router
from backend.api.search import router as search_router
from backend.api.stats import router as stats_router
from backend.api.units import router as units_router
from backend.core.config import FRONTEND_DIR, ROOT

app = FastAPI(title="C3PA Explorer", version="0.2.0")

# The frontend can be served statically (browser edition) and pointed at a
# FastAPI backend on another origin via the nav DB icon — allow that cross-
# origin access. Open by default for this demo tool.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register domain API routers
app.include_router(stats_router)
app.include_router(documents_router)
app.include_router(annotations_router)
app.include_router(units_router)
app.include_router(export_router)
app.include_router(search_router)


@app.get("/")
def index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


# Published-snapshot catalog + archive, at the RELATIVE paths the sql.js boot
# expects ("builds.json", "snapshots/<file>") so the browser edition can
# auto-load the local snapshot even when served by the backend.
@app.get("/builds.json", include_in_schema=False)
def builds_json():
    return FileResponse(os.path.join(ROOT, "builds.json"))


app.mount("/snapshots", StaticFiles(directory=str(ROOT)), name="snapshots")

# Static SPA mounts LAST — everything above (API routers, /builds.json,
# /snapshots) is registered first so it wins over the "/" fallback. Mount
# frontend files under /frontend and /static for compatibility, plus a root
# mount so the relative-path shell (index.html → js/, sqljs/, styles.css)
# resolves when the backend serves the SPA directly.
app.mount("/frontend", StaticFiles(directory=FRONTEND_DIR), name="frontend")
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="root")