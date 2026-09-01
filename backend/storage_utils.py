"""Shared Supabase Storage helpers.

Every read path in this app used to hand the browser (or `requests.get`) a
*public* bucket URL. That works only while the bucket is public, which means
any retinal scan or signed clinical report is readable by anyone holding the
link — no key, no login.

These helpers replace that with two service-role operations that work on a
**private** bucket:

* `signed_url()`   — a short-lived link safe to hand to the frontend
* `download_bytes()` — server-side fetch, no HTTP round-trip at all

Imports `.db` only, so it is safe to import from any router without touching
the `main.py` <-> router import cycle documented in CLAUDE.md.
"""

import logging
from typing import Optional

from .db import supabase

logger = logging.getLogger(__name__)

# Bucket names, so they stop being scattered string literals.
RETINAL_BUCKET = "retinal-scans"
REPORTS_BUCKET = "reports"
MC_BUCKET = "medical-certificates"
GUIDELINES_BUCKET = "guidelines"

# How long a signed link stays valid. Comfortably longer than a doctor's
# review session, short enough that a leaked or shoulder-surfed URL expires
# on its own.
SIGNED_URL_TTL_SECONDS = 3600  # 1 hour


def signed_url(bucket: str, path: str, expires_in: int = SIGNED_URL_TTL_SECONDS) -> Optional[str]:
    """Return a time-limited URL for a storage object, or None on failure.

    Never raises: a missing image should degrade to an empty panel in the UI,
    not a 500 that takes down the whole session view. Callers already handle
    a null URL (see EyePanel in the dashboards).
    """
    if not path:
        return None

    try:
        res = supabase.storage.from_(bucket).create_signed_url(path, expires_in)
    except Exception as e:
        logger.error(f"Failed to sign {bucket}/{path}: {e}")
        return None

    # storage3 has used both spellings across versions; accept either.
    if isinstance(res, dict):
        return res.get("signedURL") or res.get("signedUrl")
    return getattr(res, "signedURL", None) or getattr(res, "signedUrl", None)


def download_bytes(bucket: str, path: str) -> bytes:
    """Fetch an object's bytes with the service-role client.

    Use this instead of `requests.get(public_url)` anywhere the backend needs
    the file itself. Works on private buckets and skips a network hop.
    Raises on failure — callers decide the HTTP status.
    """
    return supabase.storage.from_(bucket).download(path)


def path_from_public_url(url: str, bucket: str) -> Optional[str]:
    """Recover an object path from a stored public URL.

    Rows written before the move to signed URLs only carry the full public
    link (`.../storage/v1/object/public/<bucket>/<path>`). This pulls the
    `<path>` back out so those legacy rows keep working on a private bucket.
    Returns None if the URL does not reference the given bucket.
    """
    if not url:
        return None

    marker = f"/{bucket}/"
    idx = url.find(marker)
    if idx == -1:
        return None

    path = url[idx + len(marker):]
    # Strip any query string (public URLs sometimes carry a cache-buster).
    return path.split("?", 1)[0] or None
