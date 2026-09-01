# backend/uploads.py

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from uuid import UUID
from datetime import datetime, timezone
from .db import supabase
from .storage_utils import signed_url
from .main import limiter

router = APIRouter(prefix="/uploads", tags=["uploads"])

BUCKET = "retinal-scans"
ALLOWED_EYES = {"left", "right"}

# ─── Upload validation ────────────────────────────────────────────────────────
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

# Client-declared Content-Type must be one of these...
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png"}

# ...and the file's real magic bytes must agree. The declared Content-Type is
# attacker-controlled, so the sniffed format below is what we actually trust.
JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _sniff_image_format(data: bytes) -> str | None:
    """
    Return the canonical MIME type inferred from the file's leading magic bytes,
    or None if the bytes are not a JPEG or PNG.

    Magic-byte sniffing is used instead of python-magic so there is no libmagic
    native dependency to install on the deployment image.
    """
    if data.startswith(JPEG_MAGIC):
        return "image/jpeg"
    if data.startswith(PNG_MAGIC):
        return "image/png"
    return None


@router.post("/retinal")
@limiter.limit("20/minute")
async def upload_retinal_image(
    request: Request,
    screening_session_id: UUID = Form(...),
    eye_side: str = Form(...),
    file: UploadFile = File(...),
):
    """
    Upload a retinal image file to Supabase Storage (bucket: retinal-scans)
    and UPSERT a row in retinal_images for (screening_session_id, eye_side),
    so replacing does NOT create duplicates.

    Validates size (<= 10 MB), declared Content-Type, and the file's real magic
    bytes BEFORE anything is sent to Supabase Storage.
    """
    eye_side = (eye_side or "").strip().lower()
    if eye_side not in ALLOWED_EYES:
        raise HTTPException(status_code=400, detail="eye_side must be 'left' or 'right'")

    # 1) Declared MIME type must be an allowed image type.
    declared_type = (file.content_type or "").split(";")[0].strip().lower()
    if declared_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Unsupported file type. Only JPEG (image/jpeg) and PNG (image/png) images are allowed.",
        )

    # 2) Reject oversized uploads early when the client reports a size.
    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="File too large. Maximum upload size is 10 MB.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file uploaded")

    # 3) Authoritative size check on the bytes actually received.
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="File too large. Maximum upload size is 10 MB.",
        )

    # 4) Magic-byte check: the real content must be a JPEG or PNG, and must
    #    match what the client claimed. Never trust Content-Type alone.
    sniffed_type = _sniff_image_format(data)
    if sniffed_type is None:
        raise HTTPException(
            status_code=415,
            detail="File content is not a valid JPEG or PNG image.",
        )
    if sniffed_type != declared_type:
        raise HTTPException(
            status_code=415,
            detail=(
                f"File content does not match its declared type "
                f"(declared {declared_type}, detected {sniffed_type})."
            ),
        )

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

    # Build a unique filename (so storage object is always new).
    # The extension comes from the VERIFIED format, not the client-supplied
    # filename, so no attacker-controlled string reaches the storage path.
    ext = ".png" if sniffed_type == "image/png" else ".jpg"

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = f"{screening_session_id}/{eye_side}_{ts}{ext}"

    # 1) Upload to Storage
   # ... existing storage upload code ...
    try:
        storage = supabase.storage.from_(BUCKET)
        storage.upload(
            path,
            data,
            file_options={"content-type": sniffed_type},
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

        # Attach a signed image_url for the frontend. The column keeps the
        # public URL written above as a stable historical record; every read
        # path re-signs from image_path instead.
        if created and created.get("image_path"):
            created["image_url"] = signed_url(BUCKET, created["image_path"])

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
    List retinal images for a screening session + a fresh signed image_url.

    The URL is recomputed from `image_path` on every read rather than served
    from the stored `image_url` column, so this single endpoint keeps every
    retinal image in the app working once the bucket is private — the nurse
    session view and the doctor's EyePanel both just render what they are
    given. Links expire (see SIGNED_URL_TTL_SECONDS).

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

        for r in rows:
            path = r.get("image_path")
            r["image_url"] = signed_url(BUCKET, path) if path else None

        return {"ok": True, "data": rows}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load retinal images: {e}")
