# backend/auth_utils.py
import bcrypt

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if plain_password is None or hashed_password is None:
        return False
    plain = plain_password.encode("utf-8")
    hashed = hashed_password.encode("utf-8")
    return bcrypt.checkpw(plain, hashed)

def hash_password(plain_password: str) -> str:
    plain = plain_password.encode("utf-8")
    hashed = bcrypt.hashpw(plain, bcrypt.gensalt())
    return hashed.decode("utf-8")
