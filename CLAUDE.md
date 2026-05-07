# Visionary AI — CLAUDE.md

Clinical-grade eye disease screening system built as a Final Year Project for Malaysian healthcare. AI-assisted diabetic retinopathy, cataract, and glaucoma detection, with a nurse → doctor → patient workflow.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI (Python), run via uvicorn |
| Frontend | React + TypeScript (Vite), port 5173 |
| Database | Supabase (PostgreSQL) |
| Storage | Supabase Storage (bucket: `retinal-scans`, `guidelines`) |
| AI Model | PyTorch — ResNetWithAttention (ResNet152 + MultiheadAttention) |
| AI Explainability | Grad-CAM heatmaps via `pytorch-grad-cam` |
| LLM (summaries) | OpenAI `gpt-4o-mini` |
| LLM (RAG reports) | OpenAI `gpt-4o` |
| RAG pipeline | LangChain + OpenAI embeddings (`text-embedding-3-small`) + Supabase vector store |
| RAG evaluation | RAGAS (`ragas` + HuggingFace `datasets`) — faithfulness, answer_relevancy, context_precision |
| Auth | Custom bcrypt — no JWT; user object stored in `localStorage` |
| Email | Resend (`RESEND_API_KEY`) |
| Scheduler | APScheduler (BackgroundScheduler) — runs in-process |

---

## Running the Project

### Backend
```bash
# From project root, activate venv first
.venv\Scripts\activate

# Run FastAPI with uvicorn (must be run from project root so relative paths resolve)
uvicorn backend.main:app --reload --port 8000
```
The model loads from `backend/model/best_model.pth` at startup. If the file is missing, the backend starts but `/ai/analyze` will return 503.

**CORS is hard-coded** to `http://localhost:5173` and `http://127.0.0.1:5173`. Changing it requires a full uvicorn restart — hot-reload does NOT pick up middleware changes.

### Frontend
```bash
cd frontend-react
npm install   # first time only
npm run dev   # starts on http://localhost:5173
```

### Required `.env` (project root)
```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
RESEND_API_KEY=...
```

---

## Directory Structure

```
visionary_ai/
├── .env                          # secrets (never commit)
├── requirements.txt              # Python deps (root-level copy)
├── backend/
│   ├── main.py                   # FastAPI app, CORS, router registration, scheduler start
│   ├── db.py                     # Supabase client (uses SERVICE_ROLE_KEY)
│   ├── auth.py                   # /auth/login + /auth/register
│   ├── auth_reset.py             # /auth/forgot-password + /auth/verify-otp + /auth/reset-password
│   ├── auth_utils.py             # bcrypt hash_password / verify_password
│   ├── patients.py               # /patients CRUD
│   ├── screenings.py             # /screenings workflow + send-report
│   ├── uploads.py                # /uploads/retinal (multipart, upserts by eye_side)
│   ├── ai.py                     # /ai/* — model inference, Grad-CAM, RAG
│   ├── staff.py                  # /staff/doctors
│   ├── admin.py                  # /admin/* staff and patient management
│   ├── appointments.py           # /appointments CRUD with 30-min overlap check
│   ├── notification_service.py   # Resend email: confirmation, reminder, clinical report, OTP
│   ├── scheduler.py              # APScheduler: send_reminders + auto_no_show (every 1 min)
│   ├── requirements.txt          # backend-specific deps
│   └── model/
│       └── best_model.pth        # trained ResNetWithAttention weights
└── frontend-react/
    ├── src/
    │   ├── App.tsx               # BrowserRouter, route definitions, role redirect
    │   ├── main.tsx              # React entrypoint
    │   ├── context/
    │   │   └── AuthContext.tsx   # useAuth hook, localStorage session (key: visionary_user)
    │   ├── components/
    │   │   └── ProtectedRoute.tsx  # role-based guard, redirects wrong-role to their home
    │   ├── pages/
    │   │   ├── Landing.tsx       # dark hero, redirects logged-in users to role dashboard
    │   │   ├── Login.tsx         # email/password form + "Forgot password?" link
    │   │   ├── Register.tsx      # staff_id + email + password (validated against registry)
    │   │   ├── ForgotPassword.tsx  # 4-step OTP password reset (email → OTP → new pw → success)
    │   │   ├── NurseDashboard.tsx  # 5 sub-views: home, new-patient, workspace, session, appointments
    │   │   ├── DoctorDashboard.tsx # 3 sub-views: inbox, review (inline edit), appointments
    │   │   └── AdminDashboard.tsx  # top navbar + 2 tabs: users (staff), patients
    │   ├── services/
    │   │   └── api.ts            # Axios instance (baseURL: http://localhost:8000) + all API fns
    │   ├── types/
    │   │   └── index.ts          # all TypeScript interfaces
    │   └── utils/
    │       └── format.ts         # formatDt, getEyeSide, fmtConfidence, shortId
    └── package.json
```

---

## Backend Modules

### `main.py`
FastAPI app. Registers all routers (auth, patients, screenings, uploads, ai, staff, admin, appointments, **auth_reset**) and calls `start_scheduler()` on the `startup` event. CORS is configured here. Also exposes `GET /` (health) and `GET /db-test` (Supabase connectivity smoke test, returns `{ok, data}` or `{ok: false, error}`).

### `db.py`
Creates the global `supabase` client using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Uses `ClientOptions(storage_client_timeout=120)`.

### `auth.py` — `/auth`
- `POST /auth/login` — verifies email+bcrypt, returns user object (no token)
- `POST /auth/register` — validates staff_id against `employee_registry`, enforces email match, forces role from registry, creates `staff_users` row

### `auth_reset.py` — `/auth` (password reset)
- `POST /auth/forgot-password` — generates 6-digit OTP (expires 10 min), deletes prior unused OTPs for same email, sends via `send_otp_email`. Always returns a safe generic message regardless of whether email exists.
- `POST /auth/verify-otp` — validates OTP (unused + unexpired), marks it `used=true`. Returns 400 if invalid/expired.
- `POST /auth/reset-password` — checks a recently-used OTP exists (within 15 min), rejects if new password matches current, bcrypt-hashes and saves new password.

Requires `password_reset_otps` table (see DDL comment at top of `auth_reset.py`):
`id, email, otp_code, created_at, expires_at, used`

### `auth_utils.py`
bcrypt `hash_password(plain)` and `verify_password(plain, hashed)`.

### `patients.py` — `/patients`
- `GET /patients?q=&limit=` — search by name or ic_passport (ilike)
- `GET /patients/{id}` — single patient
- `POST /patients` — create patient

### `screenings.py` — `/screenings`
- `GET /screenings/by-patient/{patient_id}` — list sessions for a patient
- `POST /screenings/create` — creates session with auto-incremented `session_number`
- `POST /screenings/assign-doctor` — sets `assigned_doctor_id` + status=assigned (blocked if locked)
- `GET /screenings/assigned-to/{doctor_id}` — enriched inbox (joins patient name + nurse name)
- `GET /screenings/{id}` — single session (joins patient)
- `GET /screenings/{id}/doctor-review/latest` — most recent doctor_reviews row
- `POST /screenings/{id}/doctor-review` — inserts review, updates session status to approved/overridden. Blocked if status is already in `LOCKED_STATUSES` (`{approved, overridden}`). If `assigned_doctor_id` is set on the session, only that doctor may submit (returns 403 otherwise). When `decision="overridden"`, `override_reason` is required (returns 400 if missing/empty).
- `POST /screenings/{id}/send-report` — converts markdown report to HTML, emails patient via Resend
- `DELETE /screenings/{id}` — only deletes pending sessions with no uploads and no assigned doctor

### `uploads.py` — `/uploads`
- `POST /uploads/retinal` — multipart upload to `retinal-scans` bucket; UPSERTS on `(screening_session_id, eye_side)` so re-uploading replaces rather than duplicates. Saves both `image_path` and the public `image_url` to the DB row. Cleans up the old storage object after a successful replace.
- `GET /uploads/retinal/by-session/{id}` — lists images for session (max 2: left + right). Recomputes `image_url` from `image_path` on every read (overwrites the stored value).

### `ai.py` — `/ai`
- `POST /ai/analyze?screening_session_id=` — runs model on both eyes, generates Grad-CAM, uploads heatmaps to `retinal-scans/heatmaps/`, then upserts per-eye rows (with `heatmap_url`) into `ai_results` and sets session status=analysed. Requires both left and right images. Blocked if session status is in `LOCKED_STATUSES = {assigned, approved, overridden}`. The upsert dict includes: `screening_session_id, eye, disease_detected, dr_severity, referable, confidence_score, macular_involvement, llm_summary, follow_up_interval, warnings, class_probabilities, heatmap_url`. **Not** included: `predicted_class`, `disease_type`, `severity_label` — these are only ever set via doctor override (PATCH).
- `POST /ai/reanalyze/{id}` — bypasses lock, calls analyze. For admin/debug use. Not currently called by the frontend.
- `GET /ai/results/by-session/{id}` — returns ai_results rows for session
- `PATCH /ai/result/{ai_result_id}` — doctor inline override for a single eye. Accepts `{disease_detected, disease_type, severity_label}`. Nulls out `dr_severity`, `referable`, `confidence_score`, `follow_up_interval`, `llm_summary`, and sets `warnings` to `[]`. Does **not** accept `dr_severity` in the body (it's a DB enum; the endpoint sets it to null deliberately). After this PATCH, `disease_type` and `severity_label` are the only fields carrying the doctor's diagnosis.
- `POST /ai/summarise-rag?screening_session_id=` — generates full RAG clinical report via a 2-step LLM pipeline: (1) gpt-4o-mini extracts/condenses guidelines from retrieved docs, (2) gpt-4o writes the final structured report. Fetches patient history, doctor name, past session history, current AI results, then queries `match_documents` RPC (threshold=0.45, count=5). Search query is conditional: `"…for {condition} Malaysia"` for cataract/glaucoma, `"…for {condition} diabetic retinopathy Malaysia"` otherwise. Persists the report to `ai_results.rag_summary`. Defensively reads severity as `dr_severity or severity_label or 'none'` to handle doctor-overridden rows where `dr_severity` is null. **On any exception, returns `{rag_summary: "**Error generating report:** ...", references: []}` with HTTP 200 (does not raise)** — the frontend should check the body for an error prefix.
- `GET /ai/rag-summary/{id}` — returns persisted rag_summary field from the first ai_results row for the session
- `POST /ai/evaluate-rag/{screening_session_id}` — evaluates an existing RAG summary using RAGAS metrics (faithfulness, answer_relevancy, and context_relevancy/context_utilization/ContextRelevance — selected via try/except at import time depending on the installed RAGAS version, see `_context_metric_name` log line). Re-runs retrieval to build the evaluation dataset. Best-effort persists scores to `ai_results.ragas_scores`. Returns `{ok, session_id, condition, scores}`. Reads severity defensively. **Not currently called by the frontend** — used via direct HTTP for FYP evaluation.
- `GET /ai/rag-trace/{screening_session_id}` — read-only debug endpoint (no LLM calls, no DB writes) that re-runs only the RAG retrieval step. Returns `{session_id, condition, search_query, num_retrieved, retrieved_chunks: [{source, similarity, content_preview}], final_report}`. Used for FYP evaluation. ⚠️ Reads `result['dr_severity']` directly without the defensive `or severity_label` fallback (will raise `AttributeError: 'NoneType' object has no attribute 'lower'` on doctor-overridden rows). Not called by the frontend.
- `GET /ai/health` — model load status + device + classes
- `POST /ai/ingest-research?bucket_name=guidelines` — one-time ingestion of PDFs into vector store. `bucket_name` query param defaults to `"guidelines"`. Splits with chunk_size=1000, overlap=200.

### `staff.py` — `/staff`
- `GET /staff/doctors` — lists staff_users with role=doctor (for nurse dropdown)

### `admin.py` — `/admin`
All endpoints check `requester_role == "admin"`.
- `GET /admin/staff-users?role=admin` — list all staff_users
- `PATCH /admin/staff-users/{staff_id}` — update name
- `PATCH /admin/staff-users/{staff_id}/password` — reset password (bcrypt)
- `DELETE /admin/staff-users/{staff_id}` — delete account
- `GET /admin/patients?role=admin` — list all patients
- `PATCH /admin/patients/by-ic/{ic_passport}` — update name/ic_passport/contact_number
- `DELETE /admin/patients/by-ic/{ic_passport}` — delete patient

### `appointments.py` — `/appointments`
- `POST /appointments` — create appointment; enforces future datetime, 30-min overlap check per doctor, sends confirmation email, stamps `confirmation_sent_at`
- `GET /appointments?patient_id=&assigned_doctor_id=` — list (joins patient name/email)
- `PATCH /appointments/{id}` — update status or notes

### `notification_service.py`
Resend email helpers (all fire-and-forget, return bool):
- `send_appointment_confirmation(...)` — blue header, appointment details
- `send_appointment_reminder(...)` — purple header, "tomorrow" reminder
- `send_clinical_report(...)` — green header, approved RAG report HTML
- `send_otp_email(to_email, to_name, otp_code)` — dark-themed OTP email for password reset (10-min expiry)

### `scheduler.py`
APScheduler `BackgroundScheduler` runs two jobs every 1 minute (started from `main.py`'s `startup` event):
- `send_reminders()` — finds `status="scheduled"` appointments with `appointment_datetime` between `now+23h59m` and `now+24h01m` and `notification_sent_at IS NULL`. Sends reminder via `send_appointment_reminder`, then stamps `notification_sent_at`. Skips appointments with no patient email.
- `auto_no_show()` — marks `status="scheduled"` appointments whose `appointment_datetime` is more than 30 minutes in the past as `no_show`. Both timestamps are compared in UTC.

---

## AI Model Details

**Architecture**: `ResNetWithAttention`
- Backbone: ResNet152 (last FC + AvgPool removed → feature maps)
- Attention: `nn.MultiheadAttention(embed_dim=2048, num_heads=8)` over spatial positions
- Head: `nn.Linear(2048, 7)`

**7 Classes** (updated from 5):
```python
CLASSES = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative DR', 'Cataract', 'Glaucoma']
```

**Severity map** (stored in DB as `dr_severity`):
```python
{'No DR': 'none', 'Mild': 'mild', 'Moderate': 'moderate',
 'Severe': 'severe', 'Proliferative DR': 'proliferative',
 'Cataract': 'cataract', 'Glaucoma': 'glaucoma'}
```

**Referability**: `referable = predicted_idx >= 2` (Moderate and above)

**Follow-up intervals**:
- none/mild → 12 months, moderate → 6 months, severe → 3 months
- proliferative → 1 month, cataract → specialist eval, glaucoma → urgent referral

**Heatmaps**: Grad-CAM on last ResNet block (`model.backbone[-1][-1]`). Uploaded to `retinal-scans/heatmaps/` bucket. Non-fatal — if heatmap fails, analysis still completes.

**Model path**: `backend/model/best_model.pth` (relative to CWD, so uvicorn must be run from project root)

---

## Database Tables

### `staff_users`
`id, email, password_hash, role (nurse|doctor|admin), staff_id, name`

### `employee_registry`
`staff_id, email, full_name, allowed_role` — pre-populated by admin; controls who can register.

### `patients`
`id, name, ic_passport (unique), age, sex (M|F|Other), contact_number, email, diabetes_known (Yes/No/Unknown), diabetes_type, diabetes_duration_years, notes, glaucoma_family_history, elevated_iop_history, previous_eye_surgery, visual_symptoms, comorbidities, allergies, created_at, created_by`

### `screening_sessions`
`id, patient_id (FK), session_number (auto-increment per patient), status, created_by (FK staff_users), assigned_doctor_id (FK staff_users), session_date, created_at`

### `retinal_images`
`id, screening_session_id (FK), eye_side (left|right), image_path, image_url, uploaded_at`
Unique constraint: `(screening_session_id, eye_side)` — enables UPSERT re-upload.

### `ai_results`
`id, screening_session_id (FK), eye (not eye_side!), disease_detected, dr_severity, disease_type, severity_label, predicted_class, referable, confidence_score, macular_involvement, llm_summary, rag_summary, ragas_scores (jsonb), follow_up_interval, warnings (array), class_probabilities (jsonb), heatmap_url, created_at`
Unique constraint: `(screening_session_id, eye)` — enables UPSERT re-analysis.
Note: `predicted_class`, `disease_type`, and `severity_label` exist in the DB schema but are **not currently written** by `/ai/analyze` (the upsert dict omits them). `predicted_class` will always be `null`. `disease_type` and `severity_label` are only ever populated via doctor override (`PATCH /ai/result/{id}`).
Note: `heatmap_url` is populated by `/ai/analyze` from the public URL of the uploaded Grad-CAM JPEG (`retinal-scans/heatmaps/heatmap_{session_id}_{eye}.jpg`). It is `null` only when heatmap generation/upload fails.
Note: After a doctor inline override (`PATCH /ai/result/{id}`), `dr_severity`, `referable`, `confidence_score`, `follow_up_interval`, `llm_summary` are set to null and `warnings` to `[]`. Only `disease_detected`, `disease_type`, and `severity_label` carry the doctor's values. Always read severity as `dr_severity or severity_label or 'none'` defensively.

### `doctor_reviews`
`id, screening_session_id (FK), doctor_id (FK), decision (approved|overridden), final_grade_left, final_grade_right, override_reason, report_url, reviewed_at`

### `appointments`
`id, patient_id (FK), scheduled_by (FK staff_users), assigned_doctor_id (FK), appointment_datetime, status (scheduled|completed|cancelled|no_show), notes, confirmation_sent_at, notification_sent_at, created_at`

### `password_reset_otps`
`id, email, otp_code, created_at, expires_at, used (bool)` — OTP records for self-service password reset. OTPs expire after 10 minutes; used OTPs are kept so the 15-min reset window can be validated. Index on `email`.

### `documents`
Vector store table — used by LangChain `SupabaseVectorStore`. Queried via `match_documents` RPC function. Populated by `/ai/ingest-research`.

---

## Session Status Flow

```
pending → assigned → analysed → approved
                              ↘ overridden
```

### Lock Logic

| Action | Blocked when status is |
|---|---|
| Upload images | `{assigned, approved, overridden}` |
| Run AI analysis | `{assigned, approved, overridden}` |
| Assign doctor | `{approved, overridden}` — reassign allowed when `assigned` |
| Doctor review | `{approved, overridden}` |
| Delete session | anything except `pending`; also blocked if has uploads or assigned doctor |

---

## Frontend Pages & Role Routing

Routes are in `App.tsx`. `ProtectedRoute` redirects unauthenticated users to `/login` and wrong-role users to their own dashboard (not a 403 page).

| Route | Component | Role |
|---|---|---|
| `/` | Landing | public |
| `/login` | Login | public |
| `/register` | Register | public |
| `/forgot-password` | ForgotPassword | public |
| `/dashboard` | RoleRedirect | any (redirects to role home) |
| `/nurse/*` | NurseDashboard | nurse |
| `/doctor/*` | DoctorDashboard | doctor |
| `/admin/*` | AdminDashboard | admin |

### NurseDashboard — 5 sub-views (`NurseView` discriminated union)
1. **home** — search patients by name or IC/passport (default landing view)
2. **new-patient** — register a new patient
3. **workspace** — select patient, view/create screening sessions
4. **session** — upload L/R images, trigger AI, assign to doctor, delete pending session
5. **appointments** — calendar view (month/week/day toggle) of appointments scheduled by this nurse, plus booking flow

Sidebar patient list shows patient name only (IC line removed).

### DoctorDashboard — 3 sub-views (`DoctorView` discriminated union)
1. **inbox** — list sessions assigned to the logged-in doctor
2. **review** — AI Verdict section with original/heatmap toggle (EyePanel), per-eye edit widgets, RAG report, and Approve or Submit button. Raw retinal images are **not** shown as a separate section — they are accessible only via the heatmap toggle within AI Verdict. The old Override modal has been removed.
3. **appointments** — calendar view of appointments assigned to this doctor

**Per-eye inline edit flow** (replaces the old Override button):
- Each eye widget has an **Edit** button (visible when session is not locked).
- Clicking Edit switches the widget into a 3-field form: Disease Detected, Disease Type, Severity. Severity options are driven by `getSeverityOptions(diseaseType, diseaseDetected)`.
- Clicking **Confirm** opens a custom `showOverrideConfirm` modal. On confirmation, calls `PATCH /ai/result/{id}`, updates local `aiResults` state, and collapses the widget to a post-edit summary with a "Doctor Edited" amber badge.
- When at least one eye has been edited, the **Approve** button is replaced by a **Submit** button. Submit calls `POST /screenings/{id}/doctor-review` with `decision=overridden` and a fixed override reason.
- All edit state (`leftEditing`, `rightEditing`, `leftEdited`, `rightEdited`, `leftEditForm`, `rightEditForm`, `leftConfirmed`, `rightConfirmed`, `showOverrideConfirm`, `pendingConfirmEye`) resets when the doctor navigates to a different session.

Sidebar session list shows patient name + session number only (Status line removed). Refresh button next to ← Back to Inbox has been removed.

### AdminDashboard — 2 tabs (internal values: `users`, `patients`)
1. **users** ("Staff Users") — list, rename, reset password, delete staff accounts
2. **patients** — list, update (name/IC/contact), delete patient records

---

## Known Field Inconsistencies — Always Handle These

### `eye` vs `eye_side` in AI results
The `ai_results` table uses the column `eye` (not `eye_side`). The frontend `AIResult` type uses `eye_side`. The `getEyeSide()` util handles this:
```typescript
// utils/format.ts
export function getEyeSide(result: Record<string, unknown>): string {
  return ((result['eye_side'] ?? result['eye']) as string ?? '').toLowerCase();
}
```
Always use `getEyeSide(result)` when reading eye side from AI result objects.

### `diabetes_known` — string not boolean
The DB stores `diabetes_known` as the string `"Yes"`, `"No"`, or `"Unknown"`. The TypeScript `PatientCreate` interface has it typed as `boolean`. When calling `patientsAPI.create(...)` from the nurse form, cast it manually:
```typescript
diabetes_known: formData.diabetes_known ? "Yes" : "No"  // boolean → string
```

### Enriched session fields
`GET /screenings/assigned-to/{doctor_id}` returns extra fields not in the base table:
- `patient_name` (joined from `patients`)
- `assigned_by_name` (joined from `staff_users` via `created_by`)
- `session_number`, `session_date`

These are not on the `ScreeningSession` TypeScript interface — cast with `as any` or extend locally where needed.

### `macular_involvement` — string in DB, boolean in type
`ai.py` stores `"no"` (string). The `AIResult` TypeScript type has it as `boolean`. Handle defensively.

### `comorbidities` — may be list or string
In `ai.py` RAG generation, `comorbidities` from patient record may arrive as a list or a string. The backend handles this:
```python
if isinstance(comorbidities, list):
    comorbidities_str = ", ".join(comorbidities)
else:
    comorbidities_str = str(comorbidities) if comorbidities else "None"
```

### `DoctorReviewRequest` — field name mismatch between TS and Python
The TypeScript `DoctorReviewRequest` interface uses `final_dr_grade_left` / `final_dr_grade_right`, but the Python `DoctorReviewRequest` Pydantic model expects `final_grade_left` / `final_grade_right`. The backend will silently ignore the TS field names and store `null`. Always use the Python field names (`final_grade_left`, `final_grade_right`) when calling the endpoint directly.

### `dr_severity` — can be null after doctor inline override
After `PATCH /ai/result/{id}`, the `dr_severity` column is set to `null`. Any backend code that reads `result['dr_severity']` directly will raise a `NoneType` error. Always read defensively:
```python
severity = result.get('dr_severity') or result.get('severity_label') or 'none'
```
This applies in `generate_rag_summary` and `evaluate_rag` in `ai.py` (already fixed). **`rag_trace` (`GET /ai/rag-trace/{id}`) is NOT yet fixed** — it reads `result['dr_severity']` directly (`ai.py:1072`) and will crash on overridden rows. Apply the defensive pattern to any future code that reads `dr_severity` from `ai_results` rows.

### Glaucoma/IOP column names — RAG reads wrong columns
The `patients` table (and `PatientCreate` Pydantic model, `Patient` TypeScript interface, and Nurse form) uses these column names:
- `glaucoma_family_history`
- `elevated_iop_history`

But `generate_rag_summary` in `ai.py:731,751,752` reads them as:
- `family_history_glaucoma`
- `elevated_iop`

This means the RAG report **always shows "Unknown"** for these two fields, regardless of what the nurse entered. To fix, change the SELECT in `ai.py:731` to `glaucoma_family_history, elevated_iop_history` and update the corresponding `pt.get(...)` calls. (`previous_eye_surgery` and `visual_symptoms` are correctly named on both sides.)

### `RetinalImage.created_at` vs `uploaded_at`
The `retinal_images` table column is `uploaded_at` (set in `uploads.py:82`). The TypeScript `RetinalImage` interface declares `created_at: string` instead. Read defensively if you need the timestamp from this row.

### Frontend coverage gaps
- `aiAPI` does **not** expose `/ai/evaluate-rag`, `/ai/rag-trace`, or `/ai/reanalyze` — these are backend-only / FYP-evaluation endpoints called via direct HTTP (e.g. curl or test scripts), not from the React app.

---

## Auth Pattern

- No JWT. Login returns a plain user object `{user_id, email, role, staff_id, name}`.
- Stored in `localStorage` under key `visionary_user`.
- `useAuth()` reads this on mount.
- User identity is passed in request bodies where needed (e.g., `created_by`, `doctor_id`, `requester_role`).
- Admin endpoints accept `requester_role` as a query param or body field and do their own `assert_admin()` check — there is no middleware-level auth.

---

## API Conventions

All backend responses follow one of two shapes:
```json
{ "ok": true, "data": [...] }          // list/detail endpoints
{ "ok": true, "message": "..." }        // action endpoints
{ "ok": false, "detail": "..." }        // error (HTTP 4xx/5xx)
```
Exceptions to the wrapper pattern:
- **Appointments** endpoints return the appointment object directly (`AppointmentOut` model). `POST /appointments` returns HTTP 201.
- **`POST /ai/summarise-rag`** returns `{rag_summary, references}` (no `ok`). On internal exceptions, returns HTTP 200 with `rag_summary` prefixed by `"**Error generating report:** "`.
- **`GET /ai/rag-summary/{id}`** returns `{rag_summary: string | null}` (no `ok`).
- **`POST /screenings/{id}/send-report`** returns `{success: true}`.
- **`POST /ai/evaluate-rag/{id}`** returns `{ok, session_id, condition, scores}`.
- **`GET /ai/rag-trace/{id}`** returns `{session_id, condition, search_query, num_retrieved, retrieved_chunks, final_report}` (no `ok`).
- **`GET /ai/health`** returns `{ok, model_loaded, device, num_classes, classes}`.

`axios` response interceptor in `api.ts` maps `error.response.data.detail` (or `.message`) to a plain `Error` — so frontend code can just `try { … } catch (e) { toast.error(e.message) }`.

---

## Important Conventions

- **uvicorn must run from project root** — `ai.py` loads `backend/model/best_model.pth` as a relative path. Running from `backend/` will fail.
- **Model is global state in `ai.py`** — loaded once at import time. If load fails, a warning is logged but the server starts. The `/ai/analyze` endpoint checks `if model is None` and returns 503.
- **Upsert pattern** — both `retinal_images` and `ai_results` use upsert (not insert) to allow re-upload and re-analysis without creating duplicate rows. Both require unique constraints in the DB: `(screening_session_id, eye_side)` and `(screening_session_id, eye)` respectively.
- **Scheduler is always running** — `start_scheduler()` is called on every uvicorn startup event. The jobs poll every 1 minute. This is fine in dev but uses a persistent background thread.
- **No file-based frontend build step needed in dev** — `npm run dev` serves the React app directly via Vite.
- **Tailwind CSS** is used throughout the frontend (dark theme, `bg-[#0b0f14]` is the base background color).
- **react-hot-toast** is used for all notifications (top-right, 4s, dark styled).
