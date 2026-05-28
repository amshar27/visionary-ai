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
| RAG evaluation | RAGAS (`ragas` + HuggingFace `datasets`) — faithfulness, answer_relevancy, context_utilization (lazy-imported) |
| Multi-Agent Pipeline | CrewAI — four-agent crew (Researcher: gpt-4o-mini, Brief Critic: gpt-4o-mini, Writer: gpt-4o, Report Critic: gpt-4o-mini) with conditional revision loop — see `backend/agents/` |
| Rich-text editor | TipTap (`@tiptap/react`, `@tiptap/starter-kit`, `tiptap-markdown`) — WYSIWYG editing of RAG reports |
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
│   ├── ai.py                     # /ai/* — model inference, Grad-CAM, multi-agent RAG
│   ├── staff.py                  # /staff/doctors
│   ├── admin.py                  # /admin/* staff and patient management
│   ├── appointments.py           # /appointments CRUD with 30-min overlap check
│   ├── notification_service.py   # Resend email: confirmation, reminder, clinical report, OTP
│   ├── scheduler.py              # APScheduler: send_reminders + auto_no_show (every 1 min)
│   ├── requirements.txt          # backend-specific deps
│   ├── agents/                   # CrewAI multi-agent RAG pipeline (four agents, 3-phase)
│   │   ├── crew.py               # run_clinical_report_crew() — assembles + runs 3-phase pipeline (returns dict)
│   │   ├── llms.py               # researcher_llm (gpt-4o-mini), writer_llm (gpt-4o), critic_llm (gpt-4o-mini, temp=0)
│   │   ├── agents/
│   │   │   ├── researcher.py     # Agent 1 — Clinical Evidence Researcher
│   │   │   ├── brief_critic.py   # Agent 2 — Clinical Evidence Auditor (no tools, JSON verdict only)
│   │   │   ├── writer.py         # Agent 3 — Clinical Report Writer
│   │   │   └── report_critic.py  # Agent 4 — Clinical Report Quality Auditor (no tools, JSON verdict only)
│   │   ├── tasks/
│   │   │   ├── research_task.py        # Researcher's task — classify worst case + retrieve guidelines
│   │   │   ├── brief_critique_task.py  # Brief Critic's task — rubric audit of Researcher's brief
│   │   │   ├── report_task.py          # Writer's task — six-section markdown report + persist
│   │   │   ├── report_critique_task.py # Report Critic's task — rubric audit of Writer's report
│   │   │   └── report_revision_task.py # Writer's revision task — fix only flagged issues
│   │   └── tools/                # CrewAI BaseTool subclasses
│   │       ├── severity_classifier.py   # picks worst-case condition + builds search_query
│   │       ├── guideline_retrieval.py   # match_documents RPC, top-5 chunks
│   │       ├── patient_context.py       # patient demographics + risk factors
│   │       ├── screening_history.py     # prior session severities for trend detection
│   │       ├── diagnostic_assembler.py  # per-eye AI/doctor diagnosis summary
│   │       ├── doctor_lookup.py         # assigned doctor's name for report header
│   │       └── report_persist.py        # writes final markdown to ai_results.rag_summary
│   └── model/
│       └── best_model.pth        # trained ResNetWithAttention weights
└── frontend-react/
    ├── src/
    │   ├── App.tsx               # BrowserRouter, route definitions, role redirect
    │   ├── main.tsx              # React entrypoint
    │   ├── context/
    │   │   └── AuthContext.tsx   # useAuth hook, localStorage session (key: visionary_user)
    │   ├── components/
    │   │   ├── ProtectedRoute.tsx  # role-based guard, redirects wrong-role to their home
    │   │   └── RagReportEditor.tsx # TipTap WYSIWYG markdown editor for doctor RAG report editing
    │   ├── pages/
    │   │   ├── Landing.tsx       # dark hero, redirects logged-in users to role dashboard
    │   │   ├── Login.tsx         # email/password form + "Forgot password?" link
    │   │   ├── Register.tsx      # staff_id + email + password (validated against registry)
    │   │   ├── ForgotPassword.tsx  # 4-step OTP password reset (email → OTP → new pw → success)
    │   │   ├── NurseDashboard.tsx  # 6 sub-views: home, new-patient, workspace, session, appointments, all-patients
    │   │   ├── DoctorDashboard.tsx # 5 sub-views: inbox, patient-history, all-patients, review (inline edit), appointments
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
- `GET /screenings/assigned-to/{doctor_id}` — enriched inbox (patient name + nurse name). `patient_name` and `assigned_by_name` are resolved via batch lookups (separate queries to the `patients` and `staff_users` tables) rather than Supabase FK joins, because the joins returned null on this environment.
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
- `PATCH /ai/result/{ai_result_id}` — doctor inline override for a single eye. Accepts `{disease_detected, disease_type, severity_label}`. Nulls out `dr_severity`, `referable`, `confidence_score`, `follow_up_interval`, `llm_summary`, and sets `warnings` to `[]`. Does **not** accept `dr_severity` in the body (it's a DB enum; the endpoint sets it to null deliberately). After this PATCH, `disease_type` and `severity_label` are the only fields carrying the doctor's diagnosis. Also invalidates the session-wide RAG by setting `rag_summary` and `ragas_scores` to `null` on **all** `ai_results` rows for the session (not just the edited eye), because the report describes both eyes.
- `POST /ai/summarise-rag-crew?screening_session_id=` — generates full RAG clinical report via the CrewAI **four-agent** pipeline in `backend/agents/`. Phase 1 (sequential Crew): Agent 1 (Clinical Evidence Researcher, gpt-4o-mini) uses `severity_classifier` and `guideline_retrieval` to fetch and condense Malaysian ophthalmology guidelines; Agent 2 (Clinical Evidence Auditor / Brief Critic, gpt-4o-mini, temp=0) audits the brief and emits a JSON verdict (logged for observability, does not currently re-run the Researcher); Agent 3 (Clinical Report Writer, gpt-4o) uses `patient_context`, `screening_history`, `diagnostic_assembler`, `doctor_lookup`, and `report_persist` to write and persist a six-section structured markdown report. Phase 2: Agent 4 (Clinical Report Quality Auditor / Report Critic, gpt-4o-mini, temp=0) audits the draft and emits a JSON verdict. Phase 3 (conditional, only on `verdict=fail`): Writer re-runs `build_report_revision_task` to fix ONLY flagged sections and persists again via `report_persist`. The crew function returns `{rag_summary, references}` directly; the endpoint just reads those fields from the dict (fence-stripping and `.pdf` extraction happen inside the crew). On exception returns HTTP 200 with `rag_summary` prefixed by `"**Error generating report:**"`. **No-DR bypass**: if every eye in the session is classified as `'none'` (and no doctor override raised it), the CrewAI pipeline is skipped entirely and the fixed `NORMAL_SCREENING_TEMPLATE` is persisted and returned — saves tokens and avoids retrieving guidelines for "absence of disease". The same bypass is duplicated inside `crew.py` as defense-in-depth.
- `POST /ai/summarise-rag` — **DISABLED**. The original single-pipeline RAG endpoint has been commented out in `ai.py` (kept in source as a triple-quoted block for reference and possible future comparison). Superseded by `/summarise-rag-crew`. The `aiAPI.summariseRAG()` function still exists in `api.ts` but calling it will 404.
- `GET /ai/rag-summary/{id}` — returns persisted rag_summary field from the first ai_results row for the session
- `PATCH /ai/rag-summary/{session_id}` — updates `rag_summary` on **all** `ai_results` rows for the session with the provided string. Accepts `{rag_summary: string}`. Used by the doctor report TipTap editor to persist manual edits. Returns `{ok: true, message: "RAG summary updated"}`.
- `POST /ai/evaluate-rag/{screening_session_id}` — evaluates an existing RAG summary using RAGAS metrics (faithfulness, answer_relevancy, and `ContextUtilization`/`ContextRelevance`/`context_precision` — chosen via a try/except fallback chain at lazy-import time). RAGAS imports are **deferred until first call** (`_ragas_loaded` flag) so module import stays fast and avoids loading `datasets`/`ragas` unless this endpoint is hit. Re-runs retrieval to build the evaluation dataset. Best-effort persists scores to `ai_results.ragas_scores`. Returns `{ok, session_id, condition, scores}`. Reads severity defensively. **Not currently called by the frontend** — used via direct HTTP for FYP evaluation. Generated FYP trace files (`trace_*.json`) live at the project root.
- `GET /ai/rag-trace/{screening_session_id}` — read-only debug endpoint (no LLM calls, no DB writes) that re-runs only the RAG retrieval step. Returns `{session_id, condition, search_query, num_retrieved, retrieved_chunks: [{source, similarity, content_preview}], final_report}`. Used for FYP evaluation. Reads severity defensively via the `dr_severity or severity_label or 'none'` fallback (safe on doctor-overridden rows). Not called by the frontend.
- `GET /ai/health` — model load status + device + classes
- `POST /ai/ingest-research?bucket_name=guidelines` — one-time ingestion of PDFs into vector store. `bucket_name` query param defaults to `"guidelines"`. Splits with chunk_size=1000, overlap=200.

### `backend/agents/` — CrewAI multi-agent RAG pipeline
Four-agent pipeline kicked off by `/ai/summarise-rag-crew`, organised into **three sequential Crews** so a conditional revision loop can run between them. Pipeline order: Researcher → Brief Critic → Writer (phase 1) → Report Critic (phase 2) → Writer revision (phase 3, only if Report Critic verdict is `fail`).

- **`llms.py`** — `researcher_llm` (gpt-4o-mini, temperature=0.1, max_tokens=1000), `writer_llm` (gpt-4o, temperature=0.3, max_tokens=4000), and `critic_llm` (gpt-4o-mini, **temperature=0.0**, max_tokens=500). Critics are deterministic — temperature=0 — because their verdicts gate the revision loop. Each agent owns its own LLM so hyperparams can be tuned independently.
- **`crew.py`** — `run_clinical_report_crew(screening_session_id)` returns `{"rag_summary": str, "references": list[str]}` (NOT a CrewOutput). Internally runs three separate `Crew(process=Process.sequential)` instances. Between phase 1 and phase 2 it appends `brief_critique_task` to `report_task.context` at runtime (so the Writer sees the brief critique without modifying `report_task.py`). Phase 3 only runs if the Report Critic's parsed JSON verdict is `fail`; otherwise the original draft is used. Also includes a duplicated **No-DR bypass** (mirrors the same check in `ai.py`) as defense-in-depth, plus internal fence-stripping and `.pdf` reference extraction. Malformed critic JSON is treated as `pass` (logged) so a broken verdict can't block the pipeline.
- **`agents/researcher.py`** — Agent 1, Clinical Evidence Researcher. Tools: `severity_classifier`, `guideline_retrieval`. Goal: produce an evidence brief (referral timeline, management steps, urgent triggers, follow-up intervals) plus a sources list.
- **`agents/brief_critic.py`** — Agent 2, Clinical Evidence Auditor. **No tools.** Uses `critic_llm`. Receives the Researcher's brief via `context=[research_task]` and emits a raw JSON verdict `{verdict, failed_checks, revision_instruction}`. Rubric flags: `missing_referral_timeline`, `missing_management_steps`, `missing_urgent_triggers`, `retrieval_failed`, `severity_mismatch`. The verdict is **logged** but does not currently trigger a Researcher re-run — it informs the Writer (which sees it via the appended context) and provides observability.
- **`agents/writer.py`** — Agent 3, Clinical Report Writer. Tools: `patient_context`, `screening_history`, `diagnostic_assembler`, `doctor_lookup`, `report_persist`. Produces the six-section markdown report, persists via `report_persist`, then returns ONLY the markdown as its final answer (no JSON wrapping, no fences). Both the crew and the `summarise-rag-crew` endpoint defensively strip ```` ```markdown ```` fences and `"Final Answer:"` prefixes anyway.
- **`agents/report_critic.py`** — Agent 4, Clinical Report Quality Auditor. **No tools.** Uses `critic_llm`. Receives the Writer's draft via `context=[report_task]` and emits a raw JSON verdict `{verdict, failed_checks, revision_instruction}`. Rubric flags: `missing_section`, `no_risk_factor_linkage`, `followup_interval_mismatch`, `no_references_cited`, `generic_recommendations`. A `fail` verdict triggers phase 3.
- **`tasks/brief_critique_task.py`** — `build_brief_critique_task(research_task)`. Context: `[research_task]`. Expected output: raw JSON verdict (no fences, no prose).
- **`tasks/report_critique_task.py`** — `build_report_critique_task(report_task)`. Context: `[report_task]`. Expected output: raw JSON verdict.
- **`tasks/report_revision_task.py`** — `build_report_revision_task(screening_session_id, report_task, report_critique_task)`. Context: `[report_task, report_critique_task]`. Instructs the Writer to fix ONLY the flagged sections, call `report_persist` again, and return plain markdown.
- **`tools/severity_classifier.py`** — picks worst-case condition from `ai_results` rows (defensive `dr_severity or severity_label or 'none'`), builds the `search_query` ("management and referral guidelines for X Malaysia" for cataract/glaucoma, "...for X diabetic retinopathy Malaysia" for DR levels).
- **`tools/guideline_retrieval.py`** — embeds the search query via `text-embedding-3-small` and calls the `match_documents` Supabase RPC (threshold=0.45, count=5). Returns `{retrieved_docs, sources, note?}`.
- **`tools/patient_context.py`** — reads patient demographics + risk factors. Uses correct column names `glaucoma_family_history` / `elevated_iop_history` (this is where the old "always Unknown" bug was fixed).
- **`tools/screening_history.py`** — fetches prior session severities for trend detection (accepts `exclude_session_id`).
- **`tools/diagnostic_assembler.py`** — formats per-eye AI/doctor diagnosis. Suppresses confidence figures for doctor-confirmed eyes.
- **`tools/doctor_lookup.py`** — returns the assigned doctor's name for the report header.
- **`tools/report_persist.py`** — writes the final markdown to `ai_results.rag_summary` for **all** rows of the session.

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
Note: After a doctor inline override (`PATCH /ai/result/{id}`), `dr_severity`, `referable`, `confidence_score`, `follow_up_interval`, `llm_summary` are set to null and `warnings` to `[]`. Only `disease_detected`, `disease_type`, and `severity_label` carry the doctor's values. Additionally, `rag_summary` and `ragas_scores` are nulled on **all rows for the session** (session-wide invalidation). Always read severity as `dr_severity or severity_label or 'none'` defensively.

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

### NurseDashboard — 6 sub-views (`NurseView` discriminated union)
1. **home** — search patients by name or IC/passport (default landing view)
2. **new-patient** — register a new patient
3. **workspace** — select patient, view/create screening sessions
4. **session** — upload L/R images, trigger AI, assign to doctor, delete pending session
5. **appointments** — calendar view (month/week/day toggle) of appointments scheduled by this nurse, plus booking flow
6. **all-patients** — full registered-patient table (Name, IC/Passport, Sessions) with its own search bar (name OR IC, case-insensitive). Reached via the "See more patients →" link in the sidebar; back returns to `home`. Clicking a patient name navigates to that patient's `workspace`. The Sessions column currently renders `"—"` with a `// TODO: requires session count endpoint` comment — no per-patient session count endpoint exists yet.

Sidebar patient list shows patient name only (IC line removed). Required fields (Full Name, IC/Passport Number, Sex) show a red asterisk via `<span className="text-red-500">*</span>` in their labels. The sidebar now shows the **top 5 patients** ordered by patient `created_at` DESC (proxy for most-recent registration activity) when the search box is empty; when the user types, the filter expands to the full `allPatients` list (client-side `includes` on name or IC). `allPatients` is fetched once via `patientsAPI.search(undefined, 200)` on mount and refetched when `patientListKey` changes (e.g. after a new patient is registered). A "See more patients →" link below the list opens the `all-patients` sub-view; the link is hidden only when there are zero patients.

### DoctorDashboard — 5 sub-views (`DoctorView` discriminated union)
1. **inbox** — list sessions assigned to the logged-in doctor. Status filter options: `all | assigned | approved | overridden` ('pending' excluded — doctors only see sessions that have been assigned to them). Table column header is "Session No." (not "No."). Top-right of the inbox header has a **Clear** button (eraser icon, `bg-red-500 text-white`; disabled state: `bg-gray-200 text-gray-400 opacity-60 cursor-not-allowed`) next to the refresh button — opens a confirmation modal and hides all currently-visible approved/overridden sessions from the inbox view only (frontend-only, no DB writes). Disabled when there are zero clearable sessions in the current visible list.
2. **patient-history** — opened by clicking a patient in the sidebar. Title "{patient_name} — Screening History"; same table layout, status filter pills, and refresh button as the inbox, but **no Clear button** and the cleared-IDs filter is deliberately **not** applied here (this view is the way to access cleared sessions). Filters `assignedSessions` to only those whose `patient_id === selectedPatientId`.
3. **all-patients** — full table (Name, IC/Passport, Sessions) of patients with ≥1 session assigned to this doctor. Reached via the "See more patients →" link in the sidebar; back returns to inbox. Clicking a patient name navigates to `patient-history` for that patient. The Sessions column is the count of that doctor's `assignedSessions` per patient (computed locally from the in-memory list, no extra API call). IC/Passport is resolved from a `patientIcMap` populated once on mount via `patientsAPI.search(undefined, 200)` — sessions to-the-doctor don't carry `ic_passport`, so this auxiliary lookup is required.
4. **review** — AI Verdict section with original/heatmap toggle (EyePanel), per-eye edit widgets, RAG report, and Approve or Submit button. Raw retinal images are **not** shown as a separate section — they are accessible only via the heatmap toggle within AI Verdict. The old Override modal has been removed.
5. **appointments** — calendar view of appointments assigned to this doctor

**Clear button — localStorage persistence**: cleared session IDs are stored under `visionary_doctor_cleared_{doctor_id}` (per-doctor). State is loaded into a `Set<string>` on mount and persisted on every change. On each `assignedSessions` refresh the cleared list is pruned of any IDs no longer present (e.g. session reassigned away). The list is intentionally never cleared on logout — closing/clearing localStorage is the only reset path.

**Return-to-origin after approve/override**: the `review` variant of `DoctorView` carries a `returnTo` field set when the user navigates in (`{ kind: 'inbox' }` from the inbox or `{ kind: 'patient-history', patient_id, patient_name }` from a patient-history view). After a successful Approve/Submit (or via the header back button), `handleReviewBack` reads `returnTo` and navigates accordingly. The header back button always shows **← Back** (label is no longer dynamic — navigation target is correct regardless).

**Per-eye inline edit flow** (replaces the old Override button):
- Each eye widget has an **Edit** button (visible when session is not locked, but **disabled/greyed-out until a RAG report has been generated** — tooltip: "Generate Clinical Report Summary first"). The button uses a red/orange gradient style; when disabled it is `opacity-40 grayscale cursor-not-allowed`.
- Clicking Edit switches the widget into a 3-field form: Disease Detected, Disease Type, Severity. Severity options are driven by `getSeverityOptions(diseaseType, diseaseDetected)`.
- Clicking **Confirm** opens a custom `showOverrideConfirm` modal. On confirmation, calls `PATCH /ai/result/{id}`, updates local `aiResults` state, and collapses the widget to a post-edit summary with a "Doctor Edited" amber badge. Also clears `ragResult` locally (set to `null`) and shows a toast "Clinical summary cleared — click Regenerate to update it". The RAG section then shows a yellow "Needs Regeneration" card with a "Regenerate Clinical Summary" button instead of the previous report.
- When at least one eye has been edited, the **Approve** button is replaced by a **Submit** button. Submit calls `POST /screenings/{id}/doctor-review` with `decision=overridden` and a fixed override reason.
- All edit state (`leftEditing`, `rightEditing`, `leftEdited`, `rightEdited`, `leftEditForm`, `rightEditForm`, `leftConfirmed`, `rightConfirmed`, `showOverrideConfirm`, `pendingConfirmEye`) resets when the doctor navigates to a different session.

**RAG report inline edit flow** (TipTap WYSIWYG):
- The AI Clinical Summary header shows an **Edit** button (red/orange gradient, same style as widget Edit buttons) when `ragResult` exists, the session is not locked, and `isEditingReport === false`.
- Clicking Edit enters edit mode by mounting `<RagReportEditor>` (`src/components/RagReportEditor.tsx`) — a TipTap editor with `StarterKit` + the `tiptap-markdown` extension. The editor parses the current `rag_summary` as markdown on mount and exposes `getMarkdown()` via a `forwardRef` handle so the parent can pull serialized markdown back out. Toolbar buttons cover H3 / Bold / Italic / Bullet / Numbered list / Undo / Redo. The editor surface is styled (h3 17px medium, bold labels, tight lists) to match the view-mode markdown layout.
- Clicking **Cancel** exits edit mode without saving; the Edit button reappears.
- Clicking **Confirm** opens a `showSaveReportConfirm` modal. On confirmation, reads markdown via `reportEditorRef.current?.getMarkdown()`, calls `PATCH /ai/rag-summary/{session_id}` via `aiAPI.updateRagSummary`, and updates local `ragResult`.
- Edit state (`isEditingReport`, `showSaveReportConfirm`, `reportEditorRef`) resets when the doctor navigates to a different session. The `<RagReportEditor key={sessionId} />` key forces a fresh editor instance per session so its content reflects the new report.

**Inbox row helpers** — `extractPatientName(s)` and `extractAssignedByName(s)` (top of `DoctorDashboard.tsx`) read patient/nurse names defensively from either the nested Supabase join shape (`s.patients?.name`, `s.created_by_user?.name`) or the flat enriched-API shape (`patient_name`, `assigned_by_name`). Use these instead of accessing the raw fields directly.

Sidebar shows a **patient list** (not sessions): unique patients derived from `assignedSessions` via `useMemo` using `extractPatientName(s)` for the name and a defensive `patient_id` read (flat or nested-join), sorted by **most-recent `session_date` DESC** and **sliced to the top 5** when the search input is empty. Typing in the search expands matching to the full `patients` list (client-side `includes` on name). A "See more patients →" link below the list opens the `all-patients` sub-view; the link is hidden only when there are zero patients. Clicking a patient sets the view to `patient-history` for that patient. Each patient row uses the same className as the nurse sidebar patient items: `"w-full text-left px-3 py-2 rounded-xl text-sm text-gray-900 cursor-pointer"` with inline `style` for background/color/fontWeight (active: `#dbeafe`/`#1d4ed8`/600; default: `#f9fafb`/`#111827`/400) and `onMouseEnter`/`onMouseLeave` for hover — no Tailwind transition or scale utilities. Empty states: "No patients yet. Sessions will appear here once nurses assign them to you." (no patients at all) and "No patients match your search." (search yielded nothing). The **My Schedule** (appointments) sidebar nav item matches the nurse "Appointments" item exactly: wrapper div `px-3 py-2` with `borderBottom: '1px solid #f3f4f6'`; button `className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all duration-150 cursor-pointer hover:shadow-sm"` with inline style for active (`#dbeafe`/`#1d4ed8`) vs default (`transparent`/`#374151`) and `onMouseEnter`/`onMouseLeave` hover.

### AdminDashboard — 2 tabs (internal values: `users`, `patients`)
1. **users** ("Manage System Users") — list, rename, reset password, delete staff accounts
2. **patients** ("Manage Patients") — list, update (name/IC/contact), delete patient records

The top bar uses the shared `<AppHeader>` with a red `Shield` icon in `leftSlot` and `{user.name} + Sign Out` in `rightSlot` (the "Admin" role badge that used to sit there was removed). Tab buttons live in their own row below the header. The old blue "Email + Role are read-only (HR-controlled)" info banner above the System Users table was removed. Both tables paginate at 10/page via the shared `<Pagination>` component (see Important Conventions); each tab's state resets to page 1 naturally because the inactive tab is unmounted via conditional rendering.

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
This pattern is in place in `evaluate_rag`, `rag_trace`, `_is_no_dr_session`, the CrewAI `severity_classifier` tool, and the (now-disabled) `generate_rag_summary`. Apply the same defensive pattern to any future code that reads `dr_severity` from `ai_results` rows.

### Glaucoma/IOP column names — RAG reads wrong columns — FIXED
This bug is now **FIXED** in both pipelines. Previously the original `generate_rag_summary` read the glaucoma/IOP patient fields under the wrong column names (`family_history_glaucoma` / `elevated_iop`), so the RAG report always showed "Unknown" for them. The CrewAI `patient_context` tool (`backend/agents/tools/patient_context.py`) now correctly reads `glaucoma_family_history` and `elevated_iop_history` from the `patients` table.

### `RetinalImage.created_at` vs `uploaded_at`
The `retinal_images` table column is `uploaded_at` (set in `uploads.py:82`). The TypeScript `RetinalImage` interface declares `created_at: string` instead. Read defensively if you need the timestamp from this row.

### Frontend coverage gaps
- `aiAPI` does **not** expose `/ai/evaluate-rag` or `/ai/rag-trace` — these are backend-only / FYP-evaluation endpoints called via direct HTTP (e.g. curl or test scripts), not from the React app.
- `aiAPI` **does** expose `reanalyze(sessionId)` — calls `POST /ai/reanalyze/{id}`. It exists in `api.ts` but is not triggered from the nurse/doctor UI (admin/debug only).
- `aiAPI.summariseRAGCrew(sessionId)` — calls `POST /ai/summarise-rag-crew`, the **live** RAG endpoint used by the doctor review screen.
- `aiAPI.summariseRAG(sessionId)` — still exported, but the backing endpoint `/ai/summarise-rag` is disabled (commented out in `ai.py`). Calling it will 404. Use `summariseRAGCrew` instead.
- `aiAPI.updateRagSummary(sessionId, ragSummary)` — calls `PATCH /ai/rag-summary/{id}`, used by the doctor TipTap report editor.

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
- **`POST /ai/summarise-rag-crew`** returns `{rag_summary, references}` (no `ok`). On internal exceptions, returns HTTP 200 with `rag_summary` prefixed by `"**Error generating report:** "`. For No-DR sessions, returns the fixed `NORMAL_SCREENING_TEMPLATE` with empty references and bypasses CrewAI entirely.
- **`GET /ai/rag-summary/{id}`** returns `{rag_summary: string | null}` (no `ok`).
- **`PATCH /ai/rag-summary/{id}`** returns `{ok: true, message: "RAG summary updated"}`.
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
- **Long-list pagination** — Lists that can exceed 15 items use the shared `<Pagination>` component (`src/components/Pagination.tsx`). It renders only when `totalItems > 15`, shows 15 per page, includes Prev/Next arrows + numbered pages with ellipsis compression beyond 7 pages, and smooth-scrolls to the table top on page change. Currently applied to: Doctor Inbox, Doctor Patient History, Doctor All Patients, Nurse All Patients, Nurse Workspace screening sessions (all 15/page), and Admin System Users + Admin All Patients (10/page).
- **App header with home shortcut** — All three dashboards render an `<AppHeader>` component (`src/components/AppHeader.tsx`) at the top of their main content area. It contains a "Visionary AI" logo (inline SVG eye + wordmark) that, when clicked, returns the user to their dashboard's home view (Nurse → `home`, Doctor → `inbox`, Admin → `users`). The component accepts optional `leftSlot` and `rightSlot` props so dashboards can host the hamburger toggle and contextual back buttons (left) and user/sign-out controls (right) inside the same bar. On DoctorDashboard, if the TipTap RAG editor has unsaved changes (`isEditingReport === true`), clicking the logo opens a confirmation modal (`showLogoLeaveConfirm`) before navigating; per-eye edits and other in-progress states do not trigger this guard. `isEditingReport` is lifted to the `DoctorDashboard` level (controlled prop into `ReviewView`) so the logo handler can read it.
