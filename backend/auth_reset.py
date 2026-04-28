# Run this SQL in Supabase dashboard before using this module:
# CREATE TABLE public.password_reset_otps (
#   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
#   email text NOT NULL,
#   otp_code text NOT NULL,
#   created_at timestamptz NOT NULL DEFAULT now(),
#   expires_at timestamptz NOT NULL,
#   used boolean NOT NULL DEFAULT false
# );
# CREATE INDEX idx_otp_email ON public.password_reset_otps(email);

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .db import supabase
from .auth_utils import hash_password, verify_password
from .notification_service import send_otp_email

router = APIRouter(prefix="/auth", tags=["auth-reset"])


# ─── Request models ───────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: str

class VerifyOtpRequest(BaseModel):
    email: str
    otp_code: str

class ResetPasswordRequest(BaseModel):
    email: str
    new_password: str


# ─── POST /auth/forgot-password ──────────────────────────────────────────────

@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordRequest):
    email = body.email.strip().lower()
    safe_msg = "If this email is registered, an OTP has been sent."

    # Check if email exists in staff_users
    res = supabase.table("staff_users").select("email, name").eq("email", email).execute()
    if not res.data:
        return {"ok": True, "message": safe_msg}

    user = res.data[0]

    # Generate 6-digit OTP
    otp_code = f"{secrets.randbelow(1000000):06d}"

    # Delete any existing unused OTPs for this email
    supabase.table("password_reset_otps") \
        .delete() \
        .eq("email", email) \
        .eq("used", False) \
        .execute()

    # Insert new OTP (expires in 10 minutes)
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    supabase.table("password_reset_otps").insert({
        "email": email,
        "otp_code": otp_code,
        "expires_at": expires_at,
    }).execute()

    # Send email
    send_otp_email(to_email=email, to_name=user["name"], otp_code=otp_code)

    return {"ok": True, "message": safe_msg}


# ─── POST /auth/verify-otp ───────────────────────────────────────────────────

@router.post("/verify-otp")
def verify_otp_endpoint(body: VerifyOtpRequest):
    email = body.email.strip().lower()
    otp_code = body.otp_code.strip()

    now = datetime.now(timezone.utc).isoformat()

    # Find most recent unused, unexpired OTP for this email
    res = (
        supabase.table("password_reset_otps")
        .select("*")
        .eq("email", email)
        .eq("otp_code", otp_code)
        .eq("used", False)
        .gte("expires_at", now)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not res.data:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    # Mark as used
    otp_row = res.data[0]
    supabase.table("password_reset_otps") \
        .update({"used": True}) \
        .eq("id", otp_row["id"]) \
        .execute()

    return {"ok": True, "message": "OTP verified"}


# ─── POST /auth/reset-password ───────────────────────────────────────────────

@router.post("/reset-password")
def reset_password(body: ResetPasswordRequest):
    email = body.email.strip().lower()
    new_password = body.new_password

    # Check there's a recently-used OTP (used=true, created within last 15 minutes)
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    otp_res = (
        supabase.table("password_reset_otps")
        .select("id")
        .eq("email", email)
        .eq("used", True)
        .gte("created_at", cutoff)
        .limit(1)
        .execute()
    )

    if not otp_res.data:
        raise HTTPException(status_code=400, detail="No verified OTP found. Please start over.")

    # Get current password hash
    user_res = supabase.table("staff_users").select("password_hash").eq("email", email).execute()
    if not user_res.data:
        raise HTTPException(status_code=404, detail="User not found")

    current_hash = user_res.data[0]["password_hash"]

    # Check new password is different from current
    if verify_password(new_password, current_hash):
        raise HTTPException(status_code=400, detail="New password cannot be the same as your current password")

    # Update password
    new_hash = hash_password(new_password)
    supabase.table("staff_users") \
        .update({"password_hash": new_hash}) \
        .eq("email", email) \
        .execute()

    return {"ok": True, "message": "Password reset successfully"}
