# backend/uploads.py

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from uuid import UUID
from datetime import datetime, timezone
from .db import supabase

router = APIRouter(prefix="/uploads", tags=["uploads"])

BUCKET = "retinal-scans"
ALLOWED_EYES = {"left", "right"}


@router.post("/retinal")
async def upload_retinal_image(
    screening_session_id: UUID = Form(...),
    eye_side: str = Form(...),
    file: UploadFile = File(...),
):
    """
    Upload a retinal image file to Supabase Storage (bucket: retinal-scans)
    and UPSERT a row in retinal_images for (screening_session_id, eye_side),
    so replacing does NOT create duplicates.
    """
    eye_side = (eye_side or "").strip().lower()
    if eye_side not in ALLOWED_EYES:
        raise HTTPException(status_code=400, detail="eye_side must be 'left' or 'right'")

    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file uploaded")

    # 0) Get existing row (to delete old storage object after successful replace)
    old_path = None
    try:
        old = (
            supabase.table("retinal_images")
            .select("image_path")
            .eq("screening_session_id", str(screening_session_id))
            .eq("eye_side", eye_side)
            .limit(1)
            .execute()
        )
        if old.data:
            old_path = old.data[0].get("image_path")
    except Exception:
        # Non-fatal: if this fails we still continue
        old_path = None

    # Build a unique filename (so storage object is always new)
    ext = ""
    if file.filename and "." in file.filename:
        ext = "." + file.filename.rsplit(".", 1)[-1].lower()

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = f"{screening_session_id}/{eye_side}_{ts}{ext or '.jpg'}"

    # 1) Upload to Storage
   # ... existing storage upload code ...
    try:
        storage = supabase.storage.from_(BUCKET)
        storage.upload(
            path,
            data,
            file_options={"content-type": file.content_type or "image/jpeg"},
        )
        # GENERATE PUBLIC URL HERE
        public_url = storage.get_public_url(path) # <--- Add this
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {e}")

    # 2) UPSERT DB row (replace instead of insert)
    try:
        upsert_data = {
            "screening_session_id": str(screening_session_id),
            "eye_side": eye_side,
            "image_path": path,
            "image_url": public_url, # <--- ADD THIS LINE to save it to DB
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }

        # ... rest of your code ...

        # Requires UNIQUE(screening_session_id, eye_side) in the table
        res = (
            supabase.table("retinal_images")
            .upsert(upsert_data, on_conflict="screening_session_id,eye_side")
            .execute()
        )

        created = (res.data or [None])[0]

        # Attach image_url for frontend
        if created and created.get("image_path"):
            created["image_url"] = supabase.storage.from_(BUCKET).get_public_url(created["image_path"])

        # 3) Best-effort delete old storage object (only if it existed and differs)
        if old_path and old_path != path:
            try:
                supabase.storage.from_(BUCKET).remove([old_path])
            except Exception:
                # Don't fail the request just because cleanup failed
                pass

        return {"ok": True, "data": created}

    except Exception as e:
        # If DB fails, optionally you could remove the newly uploaded file as cleanup.
        # We'll keep it simple for now.
        raise HTTPException(status_code=500, detail=f"DB upsert failed: {e}")


@router.get("/retinal/by-session/{screening_session_id}")
def list_retinal_images(screening_session_id: UUID):
    """
    List retinal images for a screening session + include public image_url.
    With the UNIQUE constraint + UPSERT, this should return at most 2 rows (left/right).
    """
    try:
        res = (
            supabase.table("retinal_images")
            .select("*")
            .eq("screening_session_id", str(screening_session_id))
            .order("uploaded_at", desc=True)
            .execute()
        )

        rows = res.data or []

        storage = supabase.storage.from_(BUCKET)
        for r in rows:
            path = r.get("image_path")
            r["image_url"] = storage.get_public_url(path) if path else None

        return {"ok": True, "data": rows}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load retinal images: {e}")
