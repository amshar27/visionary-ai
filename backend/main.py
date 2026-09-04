# backend/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

# -------------------------------------------------
# Rate limiter (defined BEFORE the router imports below)
#
# Router modules do `from .main import limiter`. Because `limiter` is bound
# here -- above the router imports -- `backend.main` is already in sys.modules
# with the attribute set by the time those modules are imported, so the
# circular import resolves. Do NOT move this below the router imports.
#
# `default_limits` applies 60/minute to every route via SlowAPIMiddleware.
# Routes carrying an explicit @limiter.limit(...) decorator override it
# (slowapi's `override_defaults` is True by default).
# -------------------------------------------------
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

# -------------------------------------------------
# Routers
# -------------------------------------------------
from .auth import router as auth_router
from .patients import router as patients_router
from .screenings import router as screenings_router
from .uploads import router as uploads_router
from .ai import router as ai_router
from .staff import router as staff_router
from .admin import router as admin_router
from .appointments import router as appointments_router
from .auth_reset import router as auth_reset_router
from .scheduler import start_scheduler

# -------------------------------------------------
# Database (optional test endpoint)
# -------------------------------------------------
from .db import supabase

# -------------------------------------------------
# Create FastAPI app FIRST
# -------------------------------------------------
app = FastAPI(title="Visionary AI Backend")

# -------------------------------------------------
# Wire the limiter into the app
# -------------------------------------------------
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# -------------------------------------------------
# CORS configuration (for React frontend on Vite dev server)
#
# NOTE: "https://visionary-ai.vercel.app" is a PLACEHOLDER. Replace it with the
# real Vercel production domain once the frontend is deployed. Vercel preview
# deployments get their own per-branch URLs and are NOT covered here -- add them
# explicitly if you need them. CORS middleware is not hot-reloaded: any change
# to this list requires a full uvicorn restart / Railway redeploy.
# -------------------------------------------------
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "https://visionary-ai.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------
# Startup event
# -------------------------------------------------
@app.on_event("startup")
async def startup_event():
    start_scheduler()

# -------------------------------------------------
# Health check
# -------------------------------------------------
@app.get("/")
def read_root():
    return {
        "status": "ok",
        "backend": "Visionary AI API is running"
    }

# -------------------------------------------------
# Optional DB test (safe to remove later)
# -------------------------------------------------
@app.get("/db-test")
def db_test():
    try:
        res = supabase.table("patients").select("*").limit(1).execute()
        return {"ok": True, "data": res.data}
    except Exception:
        return {"ok": False, "error": "Database connection failed"}

# -------------------------------------------------
# Register routers (AFTER app exists)
# -------------------------------------------------
app.include_router(auth_router)
app.include_router(patients_router)
app.include_router(screenings_router)
app.include_router(uploads_router)
app.include_router(ai_router)
app.include_router(staff_router)
app.include_router(admin_router)
app.include_router(appointments_router)
app.include_router(auth_reset_router)
