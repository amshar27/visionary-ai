// Shared form field validators. Each returns an error message string,
// or null when the value is valid.

export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (!value) return 'Email is required.';
  // Simple, pragmatic email shape check.
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) return 'Please enter a valid email address.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain a number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain a symbol.';
  return null;
}

const PHONE_RE = /^\+?\d[\d\s-]{7,14}$/;
const IC_PASSPORT_RE = /^[A-Za-z0-9-]{6,20}$/;

export function validateRequiredPassword(v: string): string | null {
  if (!v) return 'Password is required';
  return null;
}

export function validateConfirmPassword(pw: string, confirm: string): string | null {
  if (!confirm) return 'Please confirm your password';
  if (pw !== confirm) return 'Passwords do not match';
  return null;
}

export function validateName(v: string): string | null {
  if (!v.trim()) return 'Full name is required';
  if (v.trim().length < 2) return 'Name is too short';
  return null;
}

export function validateIcPassport(v: string): string | null {
  if (!v.trim()) return 'IC / Passport number is required';
  if (!IC_PASSPORT_RE.test(v.trim())) return 'Enter a valid IC or passport number';
  return null;
}

export function validateAge(v: string | number): string | null {
  if (v === '' || v === null || v === undefined) return 'Age is required';
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 120) return 'Enter a valid age (1–120)';
  return null;
}

export function validatePhone(v: string): string | null {
  if (!v.trim()) return 'Contact number is required';
  if (!PHONE_RE.test(v.trim())) return 'Enter a valid contact number';
  return null;
}
