# backend/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
# CORS configuration (for React frontend on Vite dev server)
# -------------------------------------------------
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
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
