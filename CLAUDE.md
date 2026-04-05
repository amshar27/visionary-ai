# Visionary AI — Project & Session Context

> Last updated: 2026-04-05 — generated from live codebase scan

---

## 1. Project Overview

**Visionary AI** is a clinical-grade multi-disease eye screening system built as a Final Year Project for Malaysian healthcare. Nurses upload retinal fundus images → AI model detects disease → Doctor reviews AI results and generates a RAG-powered clinical report → Doctor approves or overrides → Report sent to patient via email.

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python), uvicorn, port **8000** |
| Frontend | React 19 + TypeScript (Vite), port **5173** |
| Database | Supabase (PostgreSQL + Object Storage + pgvector) |
| AI Model | PyTorch — `ResNetWithAttention` (ResNet152 + MultiheadAttention), 5 DR classes, Grad-CAM heatmaps |
| LLM / RAG | GPT-4o-mini (per-eye `llm_summary`), GPT-4o (full RAG clinical report), LangChain + Supabase vector store |
| Auth | No JWT — bcrypt login, user object in `localStorage` as `visionary_user` |
| Email | Resend — confirmation on booking, 24-hour reminder, clinical report to patient |
| Scheduling | APScheduler (BackgroundScheduler) — two jobs run every 1 minute |

---

## 2. How to Run

```bash
# Backend — run from project root
uvicorn backend.main:app --reload --port 8000

# Frontend
cd frontend-react && npm run dev
```

CORS is configured for `http://localhost:5173` and `http://127.0.0.1:5173`. Must restart uvicorn after any CORS change — middleware is not hot-reloaded.

---

## 3. Roles & Workflow

### Nurse (`/nurse`) — 5 sub-views
1. `home` — landing screen, patient search sidebar, "Add New Patient" CTA
2. `new-patient` — full-screen registration form (sidebar hidden while active)
3. `workspace` — selected patient: view info, create sessions, upload images, trigger AI, assign doctor
4. `session` — per-session detail: AI results per eye, heatmaps, assign doctor
5. `appointments` — calendar view (Month/Week/Day) with booking modal

Patient search/selection is done exclusively via the sidebar. The sidebar auto-refreshes after a new patient is created.

### Doctor (`/doctor`) — 3 sub-views
1. `inbox` — all sessions assigned to this doctor, filterable by status; every row has an Open/View button regardless of status
2. `review` — full workflow: AI result inspection, RAG report generation, approve or override
3. `appointments` — read-only calendar of this doctor's own appointments (no booking or status-change capability)

**ReviewView workflow order (enforced):**
1. Generate Clinical Research Summary button (always visible, centred)
2. RAG loading spinner while generating
3. AI Clinical Summary card renders when `ragResult !== null`
4. Doctor Actions (Approve / Override / Send Report) only render when `ragResult !== null || isLocked`
5. `isLocked = ['approved', 'overridden'].includes(status)` — disables all action buttons in read-only mode

### Admin (`/admin`) — 2 tabs
- **System Users tab**: list all staff, update name, reset password, delete user
- **All Patients tab**: list all patients, update patient info, delete patient

---

## 4. Session Status Flow & Lock Logic

```
pending → assigned → analysed → approved
                              → overridden
```

| What is locked | Blocked when status is… |
|---|---|
| Re-upload images | `assigned`, `approved`, `overridden` |
| Re-run AI analysis | `assigned`, `approved`, `overridden` |
| Assign / reassign doctor | `approved`, `overridden` only |
| Doctor review (approve/override) | `approved`, `overridden` (already reviewed) |
| Delete session | Only deletable when `pending` AND no uploads AND no doctor assigned |

`ai.py` uses `LOCKED_STATUSES = {"assigned", "approved", "overridden"}` to block `/analyze`.
`screenings.py` uses `LOCKED_STATUSES = {"approved", "overridden"}` to block doctor review and reassignment.

---

## 5. Database Tables (Supabase)

Inferred from actual Supabase calls in backend files.

| Table | Key columns |
|---|---|
| `staff_users` | `id`, `staff_id`, `email`, `password_hash`, `role` (`nurse`/`doctor`/`admin`), `name` |
| `employees_registry` | Employee records (read-only reference) |
| `patients` | `id`, `name`, `ic_passport`, `age`, `sex`, `contact_number`, `email` (nullable), `diabetes_known` (text: `'Yes'`/`'No'`/`'Unknown'`), `diabetes_type`, `diabetes_duration_years`, `glaucoma_family_history`, `elevated_iop_history`, `previous_eye_surgery` (text, default `'Unknown'`), `visual_symptoms` (text, default `'None'`), `comorbidities`, `notes` |
| `screening_sessions` | `id`, `patient_id` (FK), `session_number`, `session_date`, `status`, `created_by` (FK → `staff_users`), `assigned_doctor_id` (FK → `staff_users`) |
| `retinal_images` | `id`, `screening_session_id` (FK), `eye_side` (text: `'left'`/`'right'`), `image_url`, `image_path` |
| `ai_results` | `id`, `screening_session_id` (FK), `eye` (text: `'left'`/`'right'`), `disease_detected` (bool), `disease_type` (text, nullable — not yet populated), `severity_label` (text, nullable — not yet populated), `dr_severity` (text), `referable` (bool), `confidence_score` (float), `class_probabilities` (json), `follow_up_interval`, `warnings` (array), `llm_summary`, `macular_involvement`, `heatmap_url`, `rag_summary` (text, nullable), `created_at` |
| `doctor_reviews` | `id`, `screening_session_id` (FK), `doctor_id` (FK), `decision` (`approved`/`overridden`), `final_grade_left`, `final_grade_right`, `override_reason`, `report_url`, `reviewed_at` |
| `documents` | pgvector store — `content`, `metadata`, `embedding` — queried via `match_documents` RPC |
| `appointments` | `id`, `patient_id` (FK), `scheduled_by` (FK → `staff_users`), `assigned_doctor_id` (FK → `staff_users`), `appointment_datetime` (timestamptz), `status` enum (`scheduled`/`completed`/`cancelled`/`no_show`), `notes`, `confirmation_sent_at` (timestamptz, nullable), `notification_sent_at` (timestamptz, nullable), `created_at` |

---

## 6. Backend Structure

All router files sit flat in `backend/` (no subfolders). Registered in `main.py` with `app.include_router(...)`.

| File | Prefix | Endpoints |
|---|---|---|
| `auth.py` | `/auth` | `POST /auth/login`, `POST /auth/register` |
| `patients.py` | `/patients` | `GET /patients` (search, `?q=&limit=`), `POST /patients`, `GET /patients/{id}` |
| `screenings.py` | `/screenings` | `GET /screenings/by-patient/{id}`, `POST /screenings/create`, `POST /screenings/assign-doctor`, `GET /screenings/assigned-to/{doctor_id}`, `GET /screenings/{id}`, `GET /screenings/{id}/doctor-review/latest`, `POST /screenings/{id}/doctor-review`, `POST /screenings/{id}/send-report`, `DELETE /screenings/{id}` |
| `uploads.py` | `/uploads` | `POST /uploads/retinal` (multipart), `GET /uploads/retinal/by-session/{id}` |
| `ai.py` | `/ai` | `POST /ai/analyze?screening_session_id=`, `GET /ai/results/by-session/{id}`, `GET /ai/health`, `POST /ai/reanalyze/{id}`, `GET /ai/rag-summary/{id}`, `POST /ai/summarise-rag?screening_session_id=`, `POST /ai/ingest-research` |
| `staff.py` | `/staff` | `GET /staff/doctors` |
| `admin.py` | `/admin` | `GET /admin/staff-users`, `PATCH /admin/staff-users/{staff_id}`, `PATCH /admin/staff-users/{staff_id}/password`, `DELETE /admin/staff-users/{staff_id}`, `GET /admin/patients`, `PATCH /admin/patients/by-ic/{ic}`, `DELETE /admin/patients/by-ic/{ic}` |
| `appointments.py` | `/appointments` | `POST /appointments`, `GET /appointments` (`?patient_id=&assigned_doctor_id=`), `PATCH /appointments/{id}` |
| `db.py` | — | Supabase client, reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env` |
| `auth_utils.py` | — | bcrypt hash/verify helpers |
| `notification_service.py` | — | No router — pure helpers: `send_appointment_confirmation()`, `send_appointment_reminder()`, `send_clinical_report()` |
| `scheduler.py` | — | `start_scheduler()` wired to `@app.on_event("startup")` — runs `send_reminders()` and `auto_no_show()` every 1 minute |

---

## 7. Frontend Structure

All pages in `frontend-react/src/pages/`. Route guards in `src/components/ProtectedRoute.tsx`.

| Route | File | Access |
|---|---|---|
| `/` | `Landing.tsx` | Public — redirects logged-in users to role dashboard |
| `/login` | `Login.tsx` | Public |
| `/register` | `Register.tsx` | Public |
| `/nurse/*` | `NurseDashboard.tsx` | Nurse only |
| `/doctor/*` | `DoctorDashboard.tsx` | Doctor only |
| `/admin/*` | `AdminDashboard.tsx` | Admin only |
| `*` | catch-all | Redirects to `/` |

### Key source files

| File | Purpose |
|---|---|
| `src/App.tsx` | React Router setup, role-based redirect (`ROLE_HOME`), global `<Toaster>` |
| `src/context/AuthContext.tsx` | `AuthProvider` + `useAuth()` hook — session via `localStorage` key `visionary_user` |
| `src/components/ProtectedRoute.tsx` | Role-based route guard |
| `src/services/api.ts` | Axios instance (`baseURL: http://localhost:8000`) — exports `authAPI`, `patientsAPI`, `screeningsAPI`, `uploadsAPI`, `aiAPI`, `staffAPI`, `adminAPI`, `appointmentsAPI` |
| `src/types/index.ts` | All TypeScript interfaces |
| `src/utils/format.ts` | `formatDt`, `getEyeSide`, `fmtConfidence`, `shortId` |
| `src/index.css` | Tailwind v4 entry |

### NurseDashboard sub-view components (all inline in `NurseDashboard.tsx`)

| Component / view | Renders when |
|---|---|
| `home` view | default |
| `NewPatientView` | `view.name === 'new-patient'` |
| `WorkspaceView` | `view.name === 'workspace'` |
| `SessionView` | `view.name === 'session'` |
| `AppointmentsView` + `BookAppointmentModal` | `view.name === 'appointments'` |
| `ApptChip` | Inside `AppointmentsView` week/day grids |

### DoctorDashboard sub-view components (all inline in `DoctorDashboard.tsx`)

| Component / view | Renders when |
|---|---|
| `InboxView` | `view.name === 'inbox'` |
| `ReviewView` | `view.name === 'review'` |
| `DoctorAppointmentsView` | `view.name === 'appointments'` |

---

## 8. Key Conventions & Known Gotchas

### Field naming

| Field | Notes |
|---|---|
| `eye` vs `eye_side` | `ai_results` table uses `eye` (inserted by `ai.py`); `retinal_images` uses `eye_side`. Always normalise with `getEyeSide(result)` from `utils/format.ts` which reads `result.eye_side ?? result.eye` |
| `diabetes_known` | Stored as string `'Yes'`/`'No'`/`'Unknown'` in DB and sent as string from frontend. TypeScript `PatientCreate` types it as `boolean` — cast at call site with `as unknown as boolean` when needed |
| `email` on PatientCreate | Not in the `PatientCreate` TypeScript interface — appended manually to the payload at the call site. Send `null` (never `""`) if empty |
| Enriched session fields | `patient_name`, `session_number`, `session_date`, `assigned_by_name` are joined fields not on the base `ScreeningSession` type — access via `(session as unknown as Record<string, unknown>).field_name` |
| Supabase join key | When `GET /screenings/{id}` joins patients, Supabase returns the join under key `patients` (the table name), not `patient`. Access as `(session as any)?.patients?.email` |
| `DoctorReviewRequest` type | ⚠️ **Bug**: `src/types/index.ts` still has `final_dr_grade_left`/`final_dr_grade_right` (old names). The backend Pydantic model uses `final_grade_left`/`final_grade_right`. The `DoctorReview` response interface already uses the correct new names. The TypeScript request type needs updating. |

### Auth pattern
- Login hits `POST /auth/login` → returns user object
- Stored in `localStorage` under key `'visionary_user'`
- `AuthContext` restores from localStorage on mount
- No tokens, no expiry — user identity passed in request bodies where needed (`created_by`, `doctor_id`, `scheduled_by`, etc.)

### Tailwind v4 setup
- Entry: `@import "tailwindcss"` in `src/index.css` — NOT `@tailwind base/components/utilities`
- Plugin: `@plugin "@tailwindcss/typography"` in `index.css` (not in a config file)
- Custom tokens: `@theme { --color-primary: #0ea5e9; --font-sans: 'Inter', system-ui, sans-serif; }`

### `npm` dependencies (key)
```
react@19, react-router-dom@7, axios@1
lucide-react, react-hot-toast, react-markdown
tailwindcss@4, @tailwindcss/vite@4, @tailwindcss/typography@0.5
vite@7, typescript@5
```

---

## 9. Appointments Feature

### Booking flow
1. Nurse opens Appointments calendar → clicks "Set New Appointment"
2. `BookAppointmentModal` — selects patient, doctor, date (min = today), time via hour/minute/AM-PM dropdowns
3. Time conversion: `AM: hour === 12 ? 0 : hour` / `PM: hour === 12 ? 12 : hour + 12`
4. Builds ISO string: `"YYYY-MM-DDTHH:MM:00+08:00"` (hardcoded UTC+8 offset)
5. **Frontend guard**: if constructed datetime ≤ now → `toast.error(...)` and return without calling API
6. **Backend guard** (`POST /appointments`): `if payload.appointment_datetime <= datetime.now(timezone.utc)` → HTTP 400
7. **Overlap check**: backend rejects if doctor has another active appointment within 30 minutes (excludes `cancelled` and `no_show`); returns HTTP 409 — frontend shows "Appointments must be at least 30 minutes apart."
8. On success: inserts row, sends confirmation email (if patient has email), stamps `confirmation_sent_at`

### Calendar timezone handling
All `appointment_datetime` values from the API are parsed into MYT (UTC+8) for display:
```ts
const localDate = new Date(new Date(appt.appointment_datetime)
  .toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
```
Applied in: `ApptChip` (chip label time), `apptForDay` (day column placement), `apptForSlot` (hour row placement). Week boundary (`weekStart`) is also derived from KL local time.

### Email notifications
| Trigger | Function | Guard column | Header colour |
|---|---|---|---|
| Immediately after `POST /appointments` | `send_appointment_confirmation()` | `confirmation_sent_at` | Blue `#2563eb` |
| 24 hours before `appointment_datetime` | `send_appointment_reminder()` | `notification_sent_at` | Purple `#7c3aed` |
| After doctor approves/overrides | `send_clinical_report()` | — (manual trigger) | Green `#16a34a` |

All email functions: try/except, print on error, return `bool`. From address: `"Visionary AI <onboarding@resend.dev>"`. `RESEND_API_KEY` read from `.env`.

Datetime displayed in emails: localised to `Asia/Kuala_Lumpur` via `pytz`, formatted as `"Wednesday, 08 April 2026 at 06:00 PM"`.

### Scheduler jobs (`backend/scheduler.py`)
Both jobs run every **1 minute** via APScheduler `BackgroundScheduler`, started in `@app.on_event("startup")`.

| Job | Logic |
|---|---|
| `send_reminders()` | Finds appointments where `appointment_datetime` is between `now+23h59m` and `now+24h01m`, `notification_sent_at IS NULL`, `status='scheduled'` → sends reminder → stamps `notification_sent_at` |
| `auto_no_show()` | Finds appointments where `appointment_datetime < now-30min`, `status='scheduled'` → updates to `no_show` |

### Status / action rules
- `scheduled`: can Mark Complete, Cancel
- `no_show`: can Mark Complete (late arrival), Cancel
- `completed` / `cancelled`: no actions available
- Only `scheduled` and `completed` block time slots — `cancelled` and `no_show` are free to rebook

---

## 10. AI Pipeline

### Model
- **Architecture**: `ResNetWithAttention` — ResNet152 backbone (all layers except final FC) + `nn.MultiheadAttention` (8 heads, embed_dim=2048) + `nn.Linear(2048, 5)`
- **File**: `backend/model/best_model.pth`
- **Classes** (5): `['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative DR']`
- **Device**: CUDA if available, else CPU
- **Transform**: Resize(256) → CenterCrop(224) → ToTensor → Normalize(ImageNet stats)

### `POST /ai/analyze` flow
1. Validates session exists and is not locked (`assigned`/`approved`/`overridden`)
2. Fetches retinal images — requires both left AND right eye images
3. For each eye: downloads image from Supabase Storage URL → runs `predict_image()` → generates Grad-CAM heatmap → uploads heatmap to `retinal-scans` bucket under `heatmaps/` path → gets public URL
4. Upserts result row to `ai_results` — conflict key: `(screening_session_id, eye)`
5. Updates session status to `'analysed'`

### `predict_image()` returns
`predicted_class`, `dr_severity` (mapped to `none`/`mild`/`moderate`/`severe`/`proliferative`), `dr_presence` (bool, any class > 0), `referable` (bool, class ≥ 2 = Moderate+), `confidence_score`, `class_probabilities`, `follow_up_interval`, `warnings[]`, `llm_summary` (GPT-4o-mini, 1 sentence), `macular_involvement` (hardcoded `"no"`)

### What is stored in `ai_results` per row
`screening_session_id`, `eye`, `disease_detected` (= `dr_presence`), `dr_severity`, `referable`, `confidence_score`, `macular_involvement`, `llm_summary`, `follow_up_interval`, `warnings`, `class_probabilities`, `heatmap_url`

⚠️ **`disease_type` and `severity_label` columns exist in DB but are NOT written by current `ai.py`** — they remain `null` until the model is updated.

### Grad-CAM
Uses `pytorch-grad-cam` library. Target layer: `model.backbone[-1]` (last layer of ResNet152 sequential). Heatmap overlaid on 224×224 resized image using `show_cam_on_image`. Saved as JPEG, uploaded to Supabase Storage. If heatmap generation fails, analysis continues without it (non-fatal).

### `POST /ai/summarise-rag` flow
1. Fetches session → patient → doctor name (from `staff_users`)
2. Fetches patient medical history and up to 3 previous sessions with their `dr_severity`
3. Fetches current AI results for the session
4. Builds RAG query: `"management and referral guidelines for {worst_severity} diabetic retinopathy Malaysia"` — **⚠️ DR-only, needs update for multi-disease**
5. Calls `match_documents` RPC (pgvector, threshold 0.5, top 3)
6. Generates structured report with GPT-4o (headings: Clinical Summary / Diagnostic Summary / Patient Risk Profile / Key Clinical Features / Recommended Management / Disclaimer)
7. Persists `rag_summary` to all `ai_results` rows for this session
8. Returns `{ rag_summary, references }`

### `GET /ai/rag-summary/{session_id}`
Returns persisted `rag_summary` or `{ rag_summary: null }` if not yet generated. Used by `ReviewView` on mount to pre-populate without re-generating.

---

## 11. UI / Styling Standards

### Shared style objects (defined at top of each dashboard file)
```ts
const inputStyle = { background: '#fff', border: '1px solid #d1d5db', color: '#111827' }
const cardStyle  = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14,
                     padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const elevatedCardStyle = { ...cardStyle, borderRadius: 14,  // or 16 in Nurse
                             boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.08)' }
```

`AdminDashboard.tsx` uses a single heavier `cardStyle` with `shadow-xl` equivalent (`0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)`) for all card widgets.

### Button standard (applied across all dashboards)
```
cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:brightness-110 active:scale-[0.98]
```
Disabled buttons: `cursor-not-allowed` — no scale or brightness animation.
Sidebar patient list items: `cursor-pointer` only, no scale/brightness.

### Colored box shadows on major action buttons (inline `style` prop)
| Button type | Box shadow |
|---|---|
| Blue (primary, Save, Set Appointment) | `0 4px 14px rgba(59,130,246,0.4)` |
| Green (Approve) | `0 4px 14px rgba(34,197,94,0.45)` |
| Orange (Override) | `0 4px 14px rgba(249,115,22,0.45)` |
| Purple (Generate RAG) | `0 4px 14px rgba(124,58,237,0.45)` |

### Per-dashboard shadow conventions
**NurseDashboard**: Home content card `shadow-xl bg-white rounded-2xl`; registration form cards `shadow-lg bg-white`; assign doctor button sits directly on page background (no card wrapper).

**DoctorDashboard**: Retinal image cards `shadow-xl`; AI diagnosis image cards `shadow-xl`; LLM Summary boxes `shadow-md bg-white`; AI results info blocks wrapped in `bg-white rounded-xl shadow-md p-4`; RAG report card `shadow-2xl`; Doctor Actions buttons not wrapped in a card.

**AdminDashboard**: Navbar `sticky top-0 z-50 bg-white shadow-md`; all card widgets use the heavy `cardStyle` (shadow-xl equivalent); lucide-react icons used (`KeyRound` for Reset Password, `Trash2` for Delete, `Save` for Save Name); non-delete buttons are blue (`bg-blue-600`).

### Status badge colours
| Status | Background | Text |
|---|---|---|
| `pending` | `#f3f4f6` | `#6b7280` |
| `assigned` | `#dbeafe` | `#1d4ed8` |
| `analysed` | `#ede9fe` | `#7c3aed` |
| `approved` | `#dcfce7` | `#16a34a` |
| `overridden` | `#ffedd5` | `#ea580c` |

### Appointment chip colours
| Status | Background | Text |
|---|---|---|
| `scheduled` | `#dbeafe` | `#1d4ed8` |
| `completed` | `#dcfce7` | `#16a34a` |
| `cancelled` | `#fee2e2` | `#dc2626` |
| `no_show` | `#f3f4f6` | `#6b7280` |

---

## 12. Immediate Next Steps & Known Issues

### AI model (deferred to teammate)
- [ ] Retrain / replace `backend/model/best_model.pth` to output `disease_type` (`"DR"` / `"Glaucoma"` / `"Cataract"` / `"Normal"`) and `disease_label` (disease-agnostic severity)
- [ ] Update `ai.py` `predict_image()` to populate `disease_type` and `severity_label` in the `result_row` dict — columns exist in DB but are currently never written
- [ ] Update warning messages in `predict_image()` — currently hardcoded as DR-specific (e.g. `"Referable diabetic retinopathy detected"`)
- [ ] Update `generate_summary()` LLM prompt — currently DR-specific
- [ ] Update `POST /ai/summarise-rag` RAG search query and LLM prompt — currently hardcoded to `"diabetic retinopathy"` and DR severity levels; must handle all 3 diseases
- [ ] Ingest Glaucoma and Cataract research PDFs into the `documents` vector store (DR papers already ingested)

### Frontend type bug
- [ ] `DoctorReviewRequest` interface in `src/types/index.ts` still has `final_dr_grade_left` / `final_dr_grade_right` (old column names). Should be `final_grade_left` / `final_grade_right` to match the backend Pydantic model and the `DoctorReview` response interface.

### Ocular risk factors in ReviewView
- [ ] Display `glaucoma_family_history`, `elevated_iop_history`, `previous_eye_surgery`, `visual_symptoms` on the patient info panel in `ReviewView` (data is stored and available but not shown to the doctor)

### End-to-end testing needed
- [ ] Full nurse → doctor workflow: upload images → analyse → assign → generate RAG → approve/override → confirm redirect + toast on Inbox
- [ ] Read-only mode: open `approved`/`overridden` session → confirm view-only banner, Approve/Override/Send Report visible but disabled
- [ ] Appointment booking: past-datetime rejection (frontend toast + backend 400), 30-minute overlap rejection (409), confirmation email delivery
