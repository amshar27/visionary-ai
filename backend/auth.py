# backend/auth.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field

from .db import supabase
from .auth_utils import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _first(rows):
    return rows[0] if rows else None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    ok: bool
    message: str
    user_id: str
    email: EmailStr
    role: str
    staff_id: str | None = None
    name: str | None = None


class RegisterRequest(BaseModel):
    staff_id: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=6)


class RegisterResponse(BaseModel):
    ok: bool
    message: str
    user_id: str
    email: EmailStr
    role: str
    staff_id: str
    name: str | None = None


@router.post("/login", response_model=LoginResponse)
def login(data: LoginRequest):
    email = (data.email or "").strip().lower()
    password = (data.password or "").strip()

    # Find user by email
    res = (
        supabase.table("staff_users")
        .select("id,email,password_hash,role,staff_id,name")
        .eq("email", email)
        .limit(1)
        .execute()
    )

    user = _first(res.data)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not verify_password(password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    role = (user.get("role") or "").lower()
    if role not in {"nurse", "doctor", "admin"}:
        raise HTTPException(status_code=403, detail="Account role is not allowed.")

    return {
        "ok": True,
        "message": f"Login successful. Welcome, {user.get('name', 'User')}!",
        "user_id": user["id"],
        "email": user["email"],
        "role": role,
        "staff_id": user.get("staff_id"),
        "name": user.get("name"),
    }


@router.post("/register", response_model=RegisterResponse)
def register(data: RegisterRequest):
    staff_id = (data.staff_id or "").strip()
    email = (data.email or "").strip().lower()
    password = (data.password or "").strip()

    # 1) staff_id must exist in employee_registry
    emp_res = (
        supabase.table("employee_registry")
        .select("staff_id,email,full_name,allowed_role")
        .eq("staff_id", staff_id)
        .limit(1)
        .execute()
    )

    employee = _first(emp_res.data)
    if not employee:
        raise HTTPException(
            status_code=403,
            detail="Staff ID not found in employee registry. Please contact admin."
        )

    # 2) Enforce email matches registry
    reg_email = (employee.get("email") or "").strip().lower()
    if reg_email and reg_email != email:
        raise HTTPException(status_code=403, detail="Email does not match the employee registry record.")

    # 3) Prevent duplicate account
    existing = (
        supabase.table("staff_users")
        .select("id")
        .eq("email", email)
        .limit(1)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=409, detail="Account already exists. Please log in.")

    # 4) Force role + name from registry
    role = (employee.get("allowed_role") or "").strip().lower()
    name = (employee.get("full_name") or "").strip() or None

    if role not in {"nurse", "doctor", "admin"}:
        raise HTTPException(status_code=403, detail="Registry role is not allowed.")

    # 5) Create user
    password_hash = hash_password(password)

    payload = {
        "email": email,
        "password_hash": password_hash,
        "role": role,
        "staff_id": staff_id,
        "name": name,
    }

    created = supabase.table("staff_users").insert(payload).execute()
    row = _first(created.data)

    if not row:
        raise HTTPException(status_code=500, detail="Failed to create user. Please try again.")

    return {
        "ok": True,
        "message": "Registration successful. You may now log in.",
        "user_id": row["id"],
        "email": row["email"],
        "role": (row.get("role") or role),
        "staff_id": row.get("staff_id") or staff_id,
        "name": row.get("name") or name,
    }
