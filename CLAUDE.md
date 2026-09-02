# Visionary AI — CLAUDE.md

Clinical-grade eye disease screening system built as a Final Year Project for Malaysian healthcare. AI-assisted diabetic retinopathy, cataract, and glaucoma detection, with a nurse → doctor → patient workflow.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI (Python), run via uvicorn |
| Frontend | React + TypeScript (Vite), port 5173 |
| Database | Supabase (PostgreSQL) — RLS deny-by-default on all 11 tables; backend connects with the service role, which bypasses it (see "Row Level Security (implemented)") |
| Storage | Supabase Storage (buckets: `retinal-scans`, `guidelines`, `reports`, `medical-certificates`). Backend reads via service role / 1-hour signed URLs — `backend/storage_utils.py`. **The buckets are still public until flipped by hand.** |
| AI Model | PyTorch — ResNetWithAttention (ResNet152 + MultiheadAttention) |
| AI Explainability | Grad-CAM heatmaps via `pytorch-grad-cam` |
| LLM (summaries) | OpenAI `gpt-4o-mini` |
| LLM (RAG reports) | OpenAI `gpt-4o` |
| RAG pipeline | LangChain + OpenAI embeddings (`text-embedding-3-small`) + Supabase vector store |
| RAG evaluation | RAGAS (`ragas` + HuggingFace `datasets`) — faithfulness, answer_relevancy, context_utilization (lazy-imported) |
| Multi-Agent Pipeline | CrewAI — four-agent crew (Researcher: gpt-4o-mini, Brief Critic: gpt-4o-mini, Writer: gpt-4o, Report Critic: gpt-4o-mini) with two conditional revision loops (brief critic → Researcher, report critic → Writer) — see `backend/agents/` |
| Rich-text editor | TipTap (`@tiptap/react`, `@tiptap/starter-kit`, `tiptap-markdown`) — WYSIWYG editing of RAG reports |
| PDF generation | xhtml2pdf (`pisa`) — `backend/pdf_service.py` renders the signed clinical report PDF (supports base64 signature `<img>`) |
| Doctor signature | `react-signature-canvas` — canvas capture exported as a PNG data URL |
| PDF preview (frontend) | `react-pdf@9.1.1` (PDF.js / pdfjs-dist `4.4.168`, worker from cdnjs) — canvas render of the report preview |
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
HF_TOKEN=...
HF_MODEL_REPO=amshar05/visionary-ai-resnet152
```

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (`db.py`) — bypasses RLS, server-side only |
| `OPENAI_API_KEY` | LLM summaries, RAG reports, embeddings, CrewAI agents |
| `RESEND_API_KEY` | Transactional email (`notification_service.py`) |
| `HF_TOKEN` | Hugging Face **read** token — authenticates the checkpoint download; required because the model repo is private |
| `HF_MODEL_REPO` | Hugging Face repo holding `best_model.pth` (`amshar05/visionary-ai-resnet152`) |

`HF_TOKEN` / `HF_MODEL_REPO` are only consulted when `backend/model/best_model.pth` is **absent** — see the `ai.py` entry under "Backend Modules". Locally the file exists, so neither is read and startup makes no network call. On Railway the file is missing (it is gitignored — 300 MB, over GitHub's 100 MB per-file limit), so both are mandatory or the backend boots without a model and `/ai/analyze` returns 503.

---

## Deployment (Vercel + Railway)

**Status: code changes applied, not yet deployed.** The application-code prerequisites (env-driven API baseURL, SPA rewrite, CORS origin, dependency pruning) **have been made**, along with a round of security hardening (rate limiting + upload validation). Nothing has actually been pushed to Vercel or Railway yet, and the Vercel domain in the CORS list is still a **placeholder**. See §4 for what remains.

### Overview
- **Frontend** → Vercel (static Vite build, CDN-hosted)
- **Backend** → Railway (persistent container — required, see below)
- **Database/Storage** → Supabase (already managed, no changes needed)

### 1. Frontend (Vercel)

**Code change — DONE.** `frontend-react/src/services/api.ts:32` now reads:
```typescript
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  ...
});
```
The `localhost:8000` fallback keeps local dev working with no `.env` file. `import.meta.env` typechecks because `tsconfig.app.json` already sets `"types": ["vite/client"]` — no `vite-env.d.ts` is needed.

Vite only exposes env vars prefixed `VITE_` to client code (`import.meta.env`), and only at **build time** — so the var must be set in Vercel's project settings before each build, not read at runtime.

**Vercel build settings** (Framework Preset: Vite):
- Root Directory: `frontend-react`
- Build Command: `npm run build` (runs `tsc -b && vite build`, per `package.json`)
- Output Directory: `dist`
- Install Command: `npm install`
- Since this is a client-side-routed SPA (`react-router-dom`, `BrowserRouter`), Vercel needs a rewrite so deep links (e.g. `/doctor/inbox`) don't 404 on refresh. **`frontend-react/vercel.json` now exists** with:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```

**Required env vars on Vercel:**
| Var | Value |
|---|---|
| `VITE_API_URL` | The Railway backend's public URL, e.g. `https://visionary-ai-backend.up.railway.app` |

### 2. Backend (Railway)

**Why Railway, not Vercel serverless:** `backend/scheduler.py` starts an APScheduler `BackgroundScheduler` in-process on FastAPI startup (`start_scheduler()` in `main.py`), polling every 1 minute for `send_reminders()` and `auto_no_show()`. Serverless functions (Vercel, Lambda-style) spin down between requests and cannot host a long-lived background thread — the scheduler would simply stop running between invocations. Railway (and similar container platforms) keep the uvicorn process alive continuously, which this app requires. The PyTorch model load at startup (`backend/model/best_model.pth`) is also a poor fit for serverless cold starts (large dependency, slow import).

**Required env vars on Railway** (same names as the local `.env`, set as Railway project variables rather than a committed file):
| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (`db.py`) |
| `OPENAI_API_KEY` | Model inference LLM calls (`gpt-4o-mini`, `gpt-4o`, embeddings) + CrewAI agents |
| `RESEND_API_KEY` | Email sending (`notification_service.py`) |
| `HF_TOKEN` | Hugging Face read token — downloads `best_model.pth` at startup (the repo is private) |
| `HF_MODEL_REPO` | Hugging Face repo id for the checkpoint — `amshar05/visionary-ai-resnet152` |

**Start command:** Railway needs an explicit run command since there's no `Procfile` yet — e.g. `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` (Railway injects `$PORT`; the local `--port 8000` default doesn't apply). Must still run from the project root so `backend/model/best_model.pth` resolves as a relative path (per the note in "Running the Project" above).

**Code change — DONE (placeholder domain).** `backend/main.py`'s `origins` list now reads:
```python
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://visionary-ai.vercel.app",
]
```
⚠️ **`https://visionary-ai.vercel.app` is a placeholder** — replace it with the real Vercel production domain once the frontend is deployed. A comment above the list in `main.py` says the same. `allow_credentials=True` / `allow_methods=["*"]` / `allow_headers=["*"]` were deliberately left unchanged, and the list is **not** a wildcard.

Per the existing note in "Running the Project": CORS middleware is not hot-reloaded, so any change here requires a full redeploy/restart on Railway, not just a code push that gets hot-swapped.

**Dependency footprint risk:** `backend/requirements.txt` pulls in `torch`/`torchvision` (PyTorch) plus `opencv-python`, `matplotlib`, and (per the Tech Stack table) CrewAI/RAGAS/LangChain — a heavy install. Railway's free/hobby tier has build-time and image-size limits; confirm the build fits before relying on it for a live demo. **`streamlit` has been removed** from `requirements.txt` (leftover from the deleted Streamlit frontend) and `slowapi` was added (see "Security hardening" below).

### 3. Supabase

No changes needed — already a managed hosted service (DB + Storage buckets: `retinal-scans`, `guidelines`, `reports`, `medical-certificates`). Both Vercel and Railway reach it over the public internet using the same `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` already in use locally.

### 4. Pre-deployment checklist

**Code changes — done:**
- [x] Change `api.ts` baseURL to read `VITE_API_URL` (see §1)
- [x] Add `frontend-react/vercel.json` SPA rewrite (see §1)
- [x] Add a Vercel domain to `origins` in `backend/main.py` — **placeholder value**, see §2
- [x] Remove `streamlit` from `backend/requirements.txt`; add `slowapi`; patch four stale pins
- [x] Rate limiting on auth / AI / upload endpoints + a global default (see "Security hardening")
- [x] Upload size, MIME, and magic-byte validation on `/uploads/retinal`
- [x] `pip install -r backend/requirements.txt` locally — `slowapi` (0.1.10) installed in the venv

**Still outstanding (nothing has been deployed):**
- [ ] Replace the placeholder `https://visionary-ai.vercel.app` in `backend/main.py` with the real Vercel production domain
- [ ] Set `VITE_API_URL` in Vercel project settings (build-time — must be set before the build)
- [ ] Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY` in Railway project variables
- [ ] Set Railway start command to bind `0.0.0.0:$PORT` and run from project root
- [ ] Set `HF_TOKEN` and `HF_MODEL_REPO` in Railway project variables — `backend/model/best_model.pth` is gitignored and will **not** be in the deployed image, so the Hugging Face fallback in `load_model()` is the only source of weights there
- [ ] Verify the Railway build completes within plan limits given the PyTorch/CrewAI/RAGAS dependency footprint (see §2)
- [ ] Redeploy Railway after any CORS/env change — middleware and env vars are not hot-reloaded

**Database / storage hardening (code is done; these are hand-run steps):**
- [ ] Run `supabase/migrations/20260831000000_enable_rls_deny_by_default.sql` in the Supabase SQL editor (sections 0–5). Safe to run at any time — it does not change app behaviour.
- [ ] Read section 0b's output to see whether `match_documents` is SECURITY DEFINER (recorded for the write-up; the revoke covers both cases either way)
- [ ] Verify with section 7 (`pg_tables.rowsecurity`, `pg_policies`, `role_table_grants`) and the anon-key `curl` test at the bottom of the migration
- [ ] **Only after** the storage code changes are deployed and verified: flip the buckets private, one at a time, in this order — `guidelines` (zero risk) → `retinal-scans` → `reports` + `medical-certificates`. Section 6 of the migration, or the dashboard toggle. **Do not flip before the code is live** or AI analysis, report resend, and both PDF exports break.

### Security hardening (implemented)

**Rate limiting — `slowapi`.** The limiter is created in `backend/main.py`:
```python
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])
```
and wired up with `app.state.limiter = limiter`, `app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)`, and `app.add_middleware(SlowAPIMiddleware)`. Exceeding a limit returns **HTTP 429**.

⚠️ **Import-order constraint:** `limiter` is defined in `main.py` **above** the router imports, because the router modules do `from .main import limiter`. When `backend.main` is the entrypoint (`uvicorn backend.main:app`), `backend.main` is already in `sys.modules` with `limiter` bound by the time the routers import it, so the cycle resolves. **Do not move the `limiter` assignment below the router imports**, and **do not import a router module (e.g. `import backend.ai`) before `backend.main`** — doing so raises `ImportError: cannot import name 'router' from partially initialized module`. Nothing in the repo currently does this (`backend/agents/*` only import `backend.db` and `backend.agents.*`; `ai.py` imports `backend.agents.crew` lazily inside a function).

| Endpoint | Limit | Why |
|---|---|---|
| `POST /ai/analyze` | 10/minute | PyTorch inference + Grad-CAM — CPU/memory heavy |
| `POST /ai/summarise-rag-crew` | 5/minute | Four-agent CrewAI pipeline — expensive `gpt-4o` calls |
| `POST /auth/login` | 5/minute | Brute-force protection |
| `POST /auth/forgot-password` | 3/minute | OTP spam / email-cost protection |
| `POST /auth/verify-otp` | 5/minute | OTP brute-force protection |
| `POST /uploads/retinal` | 20/minute | Bandwidth + storage abuse |
| *everything else* | 60/minute | Global default via `SlowAPIMiddleware` — **no per-endpoint decorator** |

Decorated endpoints override the 60/minute default (slowapi's `override_defaults` is `True` by default). Every rate-limited endpoint takes `request: Request` as its **first** parameter — slowapi requires it.

Verified behaviourally with `TestClient`: six `POST /auth/login` calls return `401, 401, 401, 401, 401, 429`. Note the ordering caveat — the `@limiter.limit` decorator wraps the *endpoint function*, so a request that fails Pydantic validation (HTTP 422, e.g. a malformed email) returns before the decorator runs and does **not** consume the per-endpoint budget. Such requests are still capped by the 60/minute `SlowAPIMiddleware` default, which runs at middleware level ahead of validation.

**`/ai/analyze` refactor:** the endpoint body was extracted into a module-level `_analyze_session(screening_session_id)`; `analyze()` is now a thin rate-limited wrapper around it. `POST /ai/reanalyze/{id}` calls `_analyze_session(...)` directly rather than `analyze(...)`, because calling the decorated function in-process would fail (slowapi's wrapper demands a `request` argument) and would also consume the caller's `/analyze` budget. **Any future in-process caller must use `_analyze_session`, not `analyze`.**

**Upload validation — `POST /uploads/retinal`.** All checks run **before** anything is sent to Supabase Storage:
1. **Size** — rejects >10 MB with **HTTP 413**. Checked twice: `file.size` when the client reports it, then authoritatively on `len(data)` after the read.
2. **Declared MIME** — must be exactly `image/jpeg` or `image/png`, else **HTTP 415**. (Replaces the old permissive `startswith("image/")` → 400 check.)
3. **Magic bytes** — `_sniff_image_format()` matches the leading bytes against JPEG (`FF D8 FF`) or PNG (`89 50 4E 47 0D 0A 1A 0A`). Content that isn't a real JPEG/PNG → **415**, and a sniffed type that **disagrees** with the declared type → **415**. The declared `Content-Type` is never trusted on its own.

Implemented with **manual magic-byte checks, not `python-magic`** — `python-magic` needs the native `libmagic` library, which is an extra install step on Railway and generally broken on Windows without `python-magic-bin`. It is **not** a dependency of this project; do not re-add it.

**Stale pins patched.** Four pins in `backend/requirements.txt` were updated to the versions actually installed — `click==8.1.8`, `cryptography==50.0.1`, `protobuf==5.29.6`, `python-dotenv==1.2.3`. The old pins conflicted with CrewAI and pyhanko and caused an **`ImportError` at backend startup**: the pinned `cryptography` was missing the `mldsa` module that pyhanko requires. Only these four pins changed.

Two knock-on hardening changes in `uploads.py`: the storage object's stored `content-type` and its file extension are now both derived from the **verified** sniffed format instead of the client-supplied `Content-Type` / `file.filename`, so no attacker-controlled string reaches the storage path. The upsert / `eye_side` logic is unchanged.

### Security limitations (not implemented)

These are **known, unfixed** gaps. They were deliberately left out of this pass and remain real weaknesses of the deployed system — worth stating plainly in the FYP write-up rather than implying the app is production-secure.

- **No real authentication or session security.** `POST /auth/login` returns a bare user object with **no JWT, no session token, and no cookie**; the frontend stores it in `localStorage` under `visionary_user`. Consequences: any XSS on the frontend can read the whole user object; there is nothing to expire or revoke, so a "session" lasts until the user clears storage; and logout is purely client-side.
- **Endpoints are effectively unauthenticated.** Identity is passed as ordinary request data (`created_by`, `doctor_id`, `requester_role`) that the client fully controls. Admin routes call `assert_admin()` against a **client-supplied `requester_role`**, so anyone can send `requester_role=admin` and pass the check. There is no middleware-level auth and no server-side verification that a caller is who they claim to be. Rate limiting slows abuse; it does not prevent it.
- **Service-role backend — RLS is defence-in-depth, not request-level protection.** `backend/db.py` still uses `SUPABASE_SERVICE_ROLE_KEY`, which **bypasses Row Level Security** entirely, and that is deliberate. RLS is now enabled deny-by-default on all 11 tables (see "Row Level Security (implemented)" below), but because the backend holds the service role, **every DB read/write still runs with full privileges** and the API layer remains the *only* thing standing between a request and the whole database — and per the point above, that layer does not authenticate callers. What RLS buys is containment if the **anon key** is ever leaked, committed, or used by a future frontend; it does not narrow what the backend itself can do, and it fixes nothing about the client-supplied-identity problem.
- **Rate limiting is in-memory and per-instance.** slowapi defaults to in-process storage, so counters **reset on every restart/redeploy** and are **not shared across instances**. Combined with the APScheduler single-instance requirement (see "Known risks"), keep Railway at one replica; a multi-instance deploy would multiply every limit by the replica count. A shared Redis backend would be needed for real enforcement.
- **`get_remote_address` trusts the peer IP.** Behind Railway's proxy this may resolve to the proxy rather than the true client, which can cause either over-blocking (all users sharing one bucket) or under-blocking. Proper handling needs `X-Forwarded-For` parsing with a trusted-proxy configuration.
- **Uploads are not scanned or re-encoded.** Magic-byte validation confirms a file *starts* like a JPEG/PNG; it does not prove the rest is well-formed, and no malware scanning or image re-encoding is performed. (Bucket exposure is handled separately — see "Storage: private buckets + signed URLs" below. Until those buckets are actually flipped private, retinal scan and report URLs remain readable by anyone holding the link.)
- **Patient data protection.** No encryption at rest beyond Supabase defaults, no audit logging of who viewed which patient record, and no PDPA-specific data-retention controls.

### Row Level Security (implemented)

Migration: **`supabase/migrations/20260831000000_enable_rls_deny_by_default.sql`** — idempotent, run **by hand** in the Supabase SQL editor. Not applied automatically and not run by any code.

**Read this first:** enabling RLS **changes nothing about how the app behaves**. The backend holds the service role (`BYPASSRLS`), so it ignores every policy in the file. Do not read the migration as evidence that requests are now authorised — see the service-role bullet above.

**What it actually closes:** Supabase's default privileges grant `anon` full DML on the `public` schema. With RLS off, anyone holding the anon key could read every patient IC number, every `staff_users.password_hash`, and every `password_reset_otps.otp_code` — the last being a complete staff-account takeover (read the OTP, then call `/auth/reset-password`). The anon key is not in this repo and the React app never talks to Supabase directly, so this was a **latent** hole rather than an open door. The migration is the wall behind it.

Per table (all 11: `staff_users`, `employee_registry`, `patients`, `screening_sessions`, `retinal_images`, `ai_results`, `doctor_reviews`, `mc_certificates`, `appointments`, `password_reset_otps`, `documents`):
- `enable row level security`
- `revoke all ... from anon, authenticated` — PostgREST then refuses at the grant layer, before RLS is consulted
- a **restrictive** `using (false)` policy for `anon, authenticated`

**`as restrictive` is load-bearing.** Permissive policies are OR'd, so a later `create policy ... using (true)` would silently reopen the table. Restrictive policies are AND'd and cannot be overridden that way. `force row level security` was deliberately **not** used — it only subjects the table owner to RLS, which is not the threat here.

Also in the migration: sequence revokes; `alter default privileges` so **new** tables/functions are not auto-granted to `anon` (without this the migration silently stops covering the schema as it grows); and `revoke execute` on both RAG RPCs.

**RPC note — `match_documents` and `match_ai_results`.** `match_ai_results` is exposed by PostgREST but referenced nowhere in this repo (dead, but callable). On SECURITY DEFINER: it does **not** affect RAG retrieval, because `guideline_retrieval.py` calls the RPC as service role, which bypasses RLS either way. It matters in reverse — if `match_documents` **is** SECURITY DEFINER, enabling RLS on `documents` would *not* stop `anon` reading guideline chunks through it, since the function runs as its owner. The `revoke execute` closes that regardless; section 0b of the migration prints which it is.

### Storage: private buckets + signed URLs

Backend read paths no longer depend on buckets being public. **The four buckets must still be flipped private by hand** (dashboard → Storage → bucket → *Public bucket* off, or section 6 of the migration, which is commented out on purpose). Until that happens the exposure is unchanged — the code is merely ready for it.

**Order matters: code first, toggle second.** Signed URLs work on public buckets too (verified), so the app runs correctly before any toggle moves. That isolates code risk from toggle risk. Rollback at any point is flipping `public` back on.

`backend/storage_utils.py` holds the shared helpers — `signed_url(bucket, path, expires_in)` (1-hour TTL via `SIGNED_URL_TTL_SECONDS`; returns `None` rather than raising, so a missing image degrades to an empty panel instead of a 500), `download_bytes(bucket, path)`, and `path_from_public_url(url, bucket)` for legacy rows. It imports `.db` only, so it is safe to import from any router without touching the `main.py` ↔ router cycle.

| Path | Change |
|---|---|
| `uploads.py` `list_retinal_images` | `get_public_url` → `signed_url`. **This one call fixes every retinal image in the app** — the endpoint already recomputed `image_url` from `image_path` on every read, so the nurse view and the doctor's `EyePanel` need no changes. |
| `ai.py` `load_retinal_image` | New. Prefers `image_path` → service-role `download_bytes`; falls back to parsing the path out of a stored public URL (legacy rows, still works when private); only then to the old direct URL fetch. `_analyze_session` now selects `image_path` too. |
| `ai.py` `get_results_by_session` | Re-signs `heatmap_url` from the deterministic path `heatmaps/heatmap_{session_id}_{eye}.jpg`. A `null` stays `null` (Grad-CAM failed) and the dashboards already fall back to the original image. |
| `screenings.py` `_fetch_stored_pdf` | New. Replaces the three `requests.get(report_url / mc_url)` calls in `resend-report`, `report-pdf`, and `mc-pdf`. Reports live at `{session_id}.pdf`, MCs at `{mc_id}.pdf`; `mc-pdf` now also selects `id` for that fallback. |

**No frontend changes.** `EyePanel` and the nurse `<img>` render whatever URL the API hands them.

⚠️ **The stored `image_url` / `heatmap_url` / `report_url` / `mc_url` columns are now historical records, not live links.** The `get_public_url` calls that *write* them were intentionally left in place (they are stable identifiers that `path_from_public_url` parses). Every **read** path re-signs. Any new code that renders one of these columns directly will break on a private bucket — go through `storage_utils` instead.

`guidelines` is the safe one to flip first: `/ai/ingest-research` already reads it with the service-role client, so nothing breaks.

**What was verified when this landed** (buckets still public at the time):
- Signed URLs resolve on a public bucket (HTTP 200) — this is what makes "deploy the code first, flip the toggle second" safe.
- Every derived path matches the stored URLs on real rows: `heatmaps/heatmap_{sid}_{eye}.jpg`, `{session_id}.pdf`, `{mc_id}.pdf` — all downloaded successfully through the service role.
- Endpoint pass through the real app: `/uploads/retinal/by-session/{id}` and `/ai/results/by-session/{id}` return signed URLs with **no** `/object/public/` links left; `report-pdf` and `mc-pdf` return real `%PDF` bytes; missing-report and missing-MC still 404.
- `load_retinal_image` exercised on all three branches (path present / legacy URL only / neither → clean `HTTPException`).

**Not yet verified end-to-end:** the write paths — a full nurse upload → analyse → doctor approve-with-signature → email run. Worth doing before a demo, since testing it creates live patient rows and sends real email.

### Known risks
- **Cold-start latency (free tier):** Railway's free/hobby tier can idle/sleep a service after inactivity; the next request pays a cold-start penalty — worse here because startup also loads the PyTorch model into memory. **Send a warm-up request to the backend (e.g. `GET /` or `GET /ai/health`) a few minutes before any live demo** to force the container awake and the model loaded, rather than eating the delay live.
- **APScheduler + multiple instances:** if Railway ever scales the backend to more than one instance, `send_reminders()`/`auto_no_show()` would run redundantly per instance (duplicate emails, duplicate status updates) since the scheduler has no distributed lock. Keep the Railway service at a single instance/replica.
- **CORS/env drift:** the Vercel preview-deployment URL (per-PR/per-branch) differs from the production domain; only the production Vercel domain is covered by the checklist above — preview deployments will hit CORS errors against Railway unless separately allow-listed.
- **Secrets exposure:** `VITE_*` env vars are bundled into the client JS at build time and are publicly visible — never put a service-role key or `OPENAI_API_KEY` behind a `VITE_` prefix; only `VITE_API_URL` (a public URL) belongs on the frontend.
- **Signed URLs expire after 1 hour (`SIGNED_URL_TTL_SECONDS`).** URLs are minted per API response, so a normal page load is unaffected. The edge case is a review tab left open past the TTL that then re-requests an image (a React re-mount or cache miss) — the URL held in component state is stale and the image fails to load. A refresh re-fetches and fixes it. Raising the TTL trades this away against longer-lived leaked links; there is no refresh-on-expiry logic.
- **Signed URLs are unauthenticated bearer links for their lifetime.** Anyone the URL is forwarded to can open that retinal scan or report until it expires — better than a permanent public URL, but not access control. Real per-user authorisation needs the auth work described under "Security limitations".
- **RLS does not protect against a leaked service-role key.** `SUPABASE_SERVICE_ROLE_KEY` bypasses every policy in the migration. It must stay server-side only (Railway variables, never a `VITE_` var, never committed) — with it, the deny-by-default policies are irrelevant.

---

## Directory Structure

```
visionary_ai/
├── .env                          # secrets (never commit)
├── requirements.txt              # Python deps (root-level copy)
├── supabase/
│   └── migrations/               # hand-run SQL (RLS deny-by-default) — nothing applies these automatically
├── backend/
│   ├── main.py                   # FastAPI app, CORS, router registration, scheduler start
│   ├── db.py                     # Supabase client (uses SERVICE_ROLE_KEY)
│   ├── storage_utils.py          # signed_url / download_bytes / path_from_public_url (private-bucket helpers)
│   ├── auth.py                   # /auth/login + /auth/register
│   ├── auth_reset.py             # /auth/forgot-password + /auth/verify-otp + /auth/reset-password
│   ├── auth_utils.py             # bcrypt hash_password / verify_password
│   ├── patients.py               # /patients CRUD
│   ├── screenings.py             # /screenings workflow + send-report + signature PDF flow (preview/finalize/resend/report-pdf)
│   ├── uploads.py                # /uploads/retinal (multipart, upserts by eye_side)
│   ├── ai.py                     # /ai/* — model inference, Grad-CAM, multi-agent RAG
│   ├── staff.py                  # /staff/doctors
│   ├── admin.py                  # /admin/* staff and patient management
│   ├── appointments.py           # /appointments CRUD with 30-min overlap check
│   ├── notification_service.py   # Resend email: confirmation, reminder, clinical report (cover + PDF attachment), OTP
│   ├── pdf_service.py            # generate_report_pdf() — xhtml2pdf signed clinical report PDF
│   ├── scheduler.py              # APScheduler: send_reminders + auto_no_show (every 1 min)
│   ├── requirements.txt          # backend-specific deps
│   ├── agents/                   # CrewAI multi-agent RAG pipeline (four agents, 5-phase with two revision loops)
│   │   ├── crew.py               # run_clinical_report_crew() — assembles + runs 5-phase pipeline (returns dict)
│   │   ├── llms.py               # researcher_llm (gpt-4o-mini), writer_llm (gpt-4o), critic_llm (gpt-4o-mini, temp=0)
│   │   ├── agents/
│   │   │   ├── researcher.py     # Agent 1 — Clinical Evidence Researcher
│   │   │   ├── brief_critic.py   # Agent 2 — Clinical Evidence Auditor (no tools, JSON verdict only)
│   │   │   ├── writer.py         # Agent 3 — Clinical Report Writer
│   │   │   └── report_critic.py  # Agent 4 — Clinical Report Quality Auditor (no tools, JSON verdict only)
│   │   ├── tasks/
│   │   │   ├── research_task.py          # Researcher's task — classify worst case + retrieve guidelines
│   │   │   ├── research_revision_task.py # Researcher's revision task — fix only brief-critic-flagged issues
│   │   │   ├── brief_critique_task.py    # Brief Critic's task — rubric audit of Researcher's brief
│   │   │   ├── report_task.py            # Writer's task — six-section markdown report + persist
│   │   │   ├── report_critique_task.py   # Report Critic's task — rubric audit of Writer's report
│   │   │   └── report_revision_task.py   # Writer's revision task — fix only flagged issues
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
    │   │   ├── RagReportEditor.tsx # TipTap WYSIWYG markdown editor for doctor RAG report editing
    │   │   ├── AppHeader.tsx       # shared top bar: logo home-shortcut + leftSlot/rightSlot
    │   │   ├── Pagination.tsx      # shared paginator (renders only when >15 items)
    │   │   └── ViewNavArrows.tsx   # browser-style back/forward arrow row for in-app sub-view history
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
    │       ├── format.ts         # formatDt, getEyeSide, fmtConfidence, shortId
    │       └── validation.ts     # shared form-field validators (email, password, name, IC, age, phone)
    └── package.json
```

---

## Backend Modules

### `main.py`
FastAPI app. Registers all routers (auth, patients, screenings, uploads, ai, staff, admin, appointments, **auth_reset**) and calls `start_scheduler()` on the `startup` event. CORS is configured here. Also exposes `GET /` (health) and `GET /db-test` (Supabase connectivity smoke test, returns `{ok, data}` or `{ok: false, error}`).

### `db.py`
Creates the global `supabase` client using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Uses `ClientOptions(storage_client_timeout=120)`. The service role has `BYPASSRLS` — see "Row Level Security (implemented)".

### `storage_utils.py`
Shared Storage helpers so read paths do not depend on a bucket being public. Exports bucket-name constants (`RETINAL_BUCKET`, `REPORTS_BUCKET`, `MC_BUCKET`, `GUIDELINES_BUCKET`), `SIGNED_URL_TTL_SECONDS` (3600), and:
- `signed_url(bucket, path, expires_in=TTL)` — time-limited link for the frontend. Returns `None` on failure instead of raising (a missing image should be an empty panel, not a 500). Handles both `signedURL` / `signedUrl` spellings across `storage3` versions.
- `download_bytes(bucket, path)` — service-role server-side fetch. Use instead of `requests.get(public_url)`. Raises; callers pick the HTTP status.
- `path_from_public_url(url, bucket)` — recovers an object path from a stored public URL so legacy rows keep working on a private bucket. Returns `None` if the URL is not for that bucket.

Imports `.db` only — safe to import from any router without touching the `main.py` ↔ router import cycle.

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
- `POST /screenings/{id}/send-report` — converts markdown report to HTML, emails patient via Resend (legacy/manual send; the signature flow below now persists + emails the PDF instead, and the review UI no longer calls this)
- `DELETE /screenings/{id}` — only deletes pending sessions with no uploads and no assigned doctor

**Module-level helper — `_fetch_stored_pdf(bucket, stored_url, fallback_path, what) -> bytes`.** Reads an already-saved PDF back out of Storage with the service-role client. Prefers the path parsed out of the stored public URL (`path_from_public_url`), falling back to the deterministic object path these buckets are written with (`{session_id}.pdf` for reports, `{mc_id}.pdf` for MCs). Raises `HTTPException(502)` on failure. Replaced the three `requests.get(public_url)` calls that broke the moment a bucket went private — **use this, not `requests.get`, for any new stored-PDF read.**

**Doctor-signature PDF flow** (paths sit under the `/screenings` router prefix → `/screenings/sessions/...`):
- `POST /screenings/sessions/{session_id}/report-preview` — body `{report_markdown, signature_data_url, patient_name, doctor_name?, physical_exam?, prescription?, clinical_impression?, management_plan?, follow_up_interval?}`. Calls `generate_report_pdf(...)` (passing the assessment fields through) and **streams the PDF back** (`application/pdf`, `Content-Disposition: inline; filename="preview.pdf"`). **No DB writes** — preview only. The preview renders the **full combined PDF** (AI body + Doctor's Clinical Assessment section) so it matches the finalized output exactly.
- `POST /screenings/sessions/{session_id}/mc-preview` — body `{patient_name, ic_passport?, days?, date_from?, date_to?, reason?, signature_data_url, doctor_name?}`. Streams an MC PDF (`application/pdf`, `inline; filename="mc_preview.pdf"`) for the preview modal. **Option A: NO DB writes** — uses a placeholder `certificate_no = "PREVIEW"` (the real 5-digit number is only stamped at finalize) and a KL-local `mc_date` (same rule as finalize). Mirrors `report-preview`. `ic_passport` is passed from the client if available (cosmetic only); finalize still does its own server-side `ic_passport` lookup. Does **not** touch `mc_certificates`.
- `POST /screenings/sessions/{session_id}/finalize-review` — the **only commit** of the signed flow. Body: `{doctor_id, decision, override_reason?, final_grade_left?, final_grade_right?, report_markdown, signature_data_url, patient_name, patient_email?, doctor_name?, send_to_patient, physical_exam?, prescription?, clinical_impression?, management_plan?, follow_up_interval?, mc_issue, mc_days?, mc_date_from?, mc_date_to?, mc_reason?}`. Steps: (1) `generate_report_pdf` (with the assessment fields); (2) upload to the `reports` bucket at `{session_id}.pdf` (upsert; public URL captured as `report_url`); (3) update session `status = decision`; (4) insert a `doctor_reviews` row (same shape as `doctor-review` + `report_url` + the five assessment columns `physical_exam`/`prescription`/`clinical_impression`/`management_plan`/`follow_up_interval`); (5) **Medical Certificate (gated on `mc_issue`)**: resolve `patient_id` → patient `name`/`ic_passport` from the DB (never trust the client), insert an `mc_certificates` row first to obtain the serial `mc_number` + `id`, build `certificate_no = f"{mc_number:05d}"` and a **KL-local** `mc_date` (`ZoneInfo("Asia/Kuala_Lumpur")`, never naive), call `generate_mc_pdf(...)`, upload to the `medical-certificates` bucket at `{mc_id}.pdf` (upsert), then `UPDATE` the row's `mc_url`; MC failures raise a clear `HTTPException` inside the one finalize try/except; (6) if `send_to_patient` **and** `patient_email`, send **one** email via `send_clinical_report(..., attachments=[...])` — report PDF always (filename `{name}_{stamp}_report.pdf`), plus the MC PDF when issued (`{name}_{stamp}_MC.pdf`). Returns `{success, report_url, emailed, mc_url}` (`mc_url` is `null` when no MC).
- `GET /screenings/sessions/{session_id}/mc-certificate/latest` — returns the latest `mc_certificates` row for the session (most recent `created_at`) or `null`. Read-only; backs the doctor review screen's MC display via `screeningsAPI.getLatestMc`.
- `POST /screenings/sessions/{session_id}/resend-report` — body `{patient_name, patient_email}`. Re-emails the **already-saved** PDF: reads the latest `doctor_reviews.report_url`, downloads the bytes via `_fetch_stored_pdf` (service-role Storage read — private-bucket safe), calls `send_clinical_report(..., pdf_bytes=...)`. 404 if no saved report/`report_url`; 502 if the download fails. Returns `{success: true}`. No regeneration, no new signature.
- `GET /screenings/sessions/{session_id}/report-pdf` — downloads the already-saved PDF (latest `doctor_reviews.report_url`, fetched via `_fetch_stored_pdf` with the `{session_id}.pdf` object path as fallback) as a `StreamingResponse` (`application/pdf`, `attachment; filename="report_{session_id}.pdf"`). 404 if none; 502 if the storage read fails. Backs the doctor "Export as PDF" button on view-only sessions.
- `GET /screenings/sessions/{session_id}/mc-pdf` — downloads the already-saved MC PDF (latest `mc_certificates` row; selects `id,mc_url` and fetches via `_fetch_stored_pdf`, falling back to the `{mc_id}.pdf` object path) as a `StreamingResponse` (`application/pdf`, `attachment; filename="mc_{session_id}.pdf"`). 404 if no MC; 502 if the download fails. Mirrors `report-pdf`. Backs the doctor "Export MC as PDF" button on view-only sessions (shown only when an MC exists).

### `uploads.py` — `/uploads`
- `POST /uploads/retinal` — multipart upload to `retinal-scans` bucket; UPSERTS on `(screening_session_id, eye_side)` so re-uploading replaces rather than duplicates. Saves both `image_path` and the public `image_url` to the DB row (the stored URL is a historical identifier — see "Storage: private buckets + signed URLs"). The **response** carries a signed `image_url` so the UI works immediately after upload. Cleans up the old storage object after a successful replace.
- `GET /uploads/retinal/by-session/{id}` — lists images for session (max 2: left + right). Recomputes `image_url` from `image_path` on every read as a **signed** URL (overwrites the stored value). This single call is what keeps every retinal image working once the bucket is private.

### `ai.py` — `/ai`

**Checkpoint resolution — `resolve_checkpoint_path()` / `load_model()`.** `load_model()` no longer hard-codes `backend/model/best_model.pth`. It calls `resolve_checkpoint_path()`, which resolves in three tiers: (1) the local file `backend/model/best_model.pth` if it exists — the dev source of truth, no network call; (2) otherwise `huggingface_hub.hf_hub_download(repo_id=$HF_MODEL_REPO, filename="best_model.pth", token=$HF_TOKEN)`, which caches into huggingface_hub's **default** cache (`~/.cache/huggingface`) — nothing is ever written into `backend/model/`, so cached downloads never mix with the local checkpoint; (3) if neither is available it raises a `RuntimeError` naming both env vars and the expected local path, so a deploy failure is diagnosable from the first log line. On Railway the cache is ephemeral and a cold start re-downloads (~15–30s for 300 MB) — acceptable, and **no persistent volume is used or required**. The startup call keeps the pre-existing contract (server still boots, `/ai/analyze` returns 503) but now logs at **CRITICAL**, not `warning`. Both env vars are read from the environment only — no token default is baked into the code. `huggingface_hub` is imported **lazily inside** `resolve_checkpoint_path()`, so the local-file path never touches it.

- `POST /ai/analyze?screening_session_id=` — reads each eye's scan via `load_retinal_image(image_path, image_url)` (service-role Storage download, so it works on a private bucket; falls back to parsing the path out of a legacy stored URL, then to a direct URL fetch). Runs model on both eyes, generates Grad-CAM, uploads heatmaps to `retinal-scans/heatmaps/`, then upserts per-eye rows (with `heatmap_url`) into `ai_results` and sets session status=analysed. Requires both left and right images. Blocked if session status is in `LOCKED_STATUSES = {assigned, approved, overridden}`. The upsert dict includes: `screening_session_id, eye, disease_detected, dr_severity, referable, confidence_score, macular_involvement, llm_summary, follow_up_interval, warnings, class_probabilities, heatmap_url`. **Not** included: `predicted_class`, `disease_type`, `severity_label` — these are only ever set via doctor override (PATCH).
- `POST /ai/reanalyze/{id}` — bypasses lock, calls analyze. For admin/debug use. Not currently called by the frontend.
- `GET /ai/results/by-session/{id}` — returns ai_results rows for session. **Re-signs `heatmap_url`** on every read from the deterministic path `heatmaps/heatmap_{session_id}_{eye}.jpg` (a `null` stays `null` — Grad-CAM failed for that eye — and the dashboards fall back to the original image).
- `PATCH /ai/result/{ai_result_id}` — doctor inline override for a single eye. Accepts `{disease_detected, disease_type, severity_label}`. Nulls out `dr_severity`, `referable`, `confidence_score`, `follow_up_interval`, `llm_summary`, and sets `warnings` to `[]`. Does **not** accept `dr_severity` in the body (it's a DB enum; the endpoint sets it to null deliberately). After this PATCH, `disease_type` and `severity_label` are the only fields carrying the doctor's diagnosis. Also invalidates the session-wide RAG by setting `rag_summary` and `ragas_scores` to `null` on **all** `ai_results` rows for the session (not just the edited eye), because the report describes both eyes.
- `POST /ai/summarise-rag-crew?screening_session_id=` — generates full RAG clinical report via the CrewAI **four-agent** pipeline in `backend/agents/`. Phase 1 (sequential Crews): Agent 1 (Clinical Evidence Researcher, gpt-4o-mini) uses `severity_classifier` and `guideline_retrieval` to fetch and condense Malaysian ophthalmology guidelines; Agent 2 (Clinical Evidence Auditor / Brief Critic, gpt-4o-mini, temp=0) audits the brief and emits a JSON verdict; on a substantiated `fail` (verdict=fail AND non-empty failed_checks) the Researcher is re-run once to fix only the flagged issues before the Writer sees the brief; Agent 3 (Clinical Report Writer, gpt-4o) uses `patient_context`, `screening_history`, `diagnostic_assembler`, `doctor_lookup`, and `report_persist` to write and persist a six-section structured markdown report. Phase 2: Agent 4 (Clinical Report Quality Auditor / Report Critic, gpt-4o-mini, temp=0) audits the draft and emits a JSON verdict. Phase 3 (conditional, only on a substantiated `fail` — verdict=fail AND non-empty failed_checks): Writer re-runs `build_report_revision_task` to fix ONLY flagged sections and persists again via `report_persist`. A `fail` verdict with an empty `failed_checks` list is treated as a pass (logged, no revision) so contradictory critic output can't trigger a spurious re-run. The crew function returns `{rag_summary, references}` directly; the endpoint just reads those fields from the dict (fence-stripping and `.pdf` extraction happen inside the crew). **The endpoint then persists the cleaned summary to `ai_results.rag_summary` via an UPDATE on the existing per-eye row(s) for the session** (mirrors `update_rag_summary`'s write — by `screening_session_id`, all rows, last-write-wins so regeneration overwrites; no insert, no history). This was added because the agent-internal `report_persist` was not reliably writing the column, which made the summary vanish on reload (`getRagSummary` returned NULL). The write targets the **same row(s)** `get_rag_summary` reads (it reads the first row's `rag_summary`), so reload is consistent. The persist is best-effort: only runs when `cleaned` is non-empty, and a DB failure is logged but does **not** block returning the generated summary. On exception returns HTTP 200 with `rag_summary` prefixed by `"**Error generating report:**"`. **No-DR bypass**: if every eye in the session is classified as `'none'` (and no doctor override raised it), the CrewAI pipeline is skipped entirely and the fixed `NORMAL_SCREENING_TEMPLATE` is persisted and returned — saves tokens and avoids retrieving guidelines for "absence of disease". The same bypass is duplicated inside `crew.py` as defense-in-depth.
- `POST /ai/summarise-rag` — **DISABLED**. The original single-pipeline RAG endpoint has been commented out in `ai.py` (kept in source as a triple-quoted block for reference and possible future comparison). Superseded by `/summarise-rag-crew`. The `aiAPI.summariseRAG()` function still exists in `api.ts` but calling it will 404.
- `GET /ai/rag-summary/{id}` — returns persisted rag_summary field from the first ai_results row for the session
- `PATCH /ai/rag-summary/{session_id}` — updates `rag_summary` on **all** `ai_results` rows for the session with the provided string. Accepts `{rag_summary: string}`. Used by the doctor report TipTap editor to persist manual edits. Returns `{ok: true, message: "RAG summary updated"}`.
- `POST /ai/evaluate-rag/{screening_session_id}` — evaluates an existing RAG summary using RAGAS metrics (faithfulness, answer_relevancy, and `ContextUtilization`/`ContextRelevance`/`context_precision` — chosen via a try/except fallback chain at lazy-import time). RAGAS imports are **deferred until first call** (`_ragas_loaded` flag) so module import stays fast and avoids loading `datasets`/`ragas` unless this endpoint is hit. Re-runs retrieval to build the evaluation dataset. Best-effort persists scores to `ai_results.ragas_scores`. Returns `{ok, session_id, condition, scores}`. Reads severity defensively. **Not currently called by the frontend** — used via direct HTTP for FYP evaluation. Generated FYP trace files (`trace_*.json`) live at the project root.
- `GET /ai/rag-trace/{screening_session_id}` — read-only debug endpoint (no LLM calls, no DB writes) that re-runs only the RAG retrieval step. Returns `{session_id, condition, search_query, num_retrieved, retrieved_chunks: [{source, similarity, content_preview}], final_report}`. Used for FYP evaluation. Reads severity defensively via the `dr_severity or severity_label or 'none'` fallback (safe on doctor-overridden rows). Not called by the frontend.
- `GET /ai/health` — model load status + device + classes
- `POST /ai/ingest-research?bucket_name=guidelines` — one-time ingestion of PDFs into vector store. `bucket_name` query param defaults to `"guidelines"`. Splits with chunk_size=1000, overlap=200.

### `backend/agents/` — CrewAI multi-agent RAG pipeline
Four-agent pipeline kicked off by `/ai/summarise-rag-crew`, organised into **separate sequential Crews** so two independent conditional revision loops can run between them. Pipeline order: Researcher → Brief Critic (phase 1a) → Researcher revision (phase 1b, only if Brief Critic verdict is a substantiated `fail`) → Writer (phase 1c) → Report Critic (phase 2) → Writer revision (phase 3, only if Report Critic verdict is a substantiated `fail`). A "substantiated fail" means verdict=fail **and** a non-empty `failed_checks` list; a `fail` with empty `failed_checks` is logged and treated as a pass, so neither loop fires on contradictory critic output. Each revision loop runs **at most once** per invocation (the revised output is not re-audited).

- **`llms.py`** — `researcher_llm` (gpt-4o-mini, temperature=0.1, max_tokens=1000), `writer_llm` (gpt-4o, temperature=0.3, max_tokens=4000), and `critic_llm` (gpt-4o-mini, **temperature=0.0**, max_tokens=500). Critics are deterministic — temperature=0 — because their verdicts gate the revision loops. Both critics share the single `critic_llm` instance (same model + hyperparameters); only three LLM instances exist for the four agents. Each agent owns its own LLM so hyperparams can be tuned independently.
- **`crew.py`** — `run_clinical_report_crew(screening_session_id)` returns `{"rag_summary": str, "references": list[str]}` (NOT a CrewOutput). Internally runs several separate `Crew(process=Process.sequential)` instances. **Phase 1a** runs the Researcher + Brief Critic in their own Crew. The brief verdict is then parsed (`_strip_markdown_fences` → `json.loads`, malformed JSON treated as `pass`); `brief_should_revise = verdict=="fail" AND failed_checks is a non-empty list` (a missing/non-list `failed_checks` is coerced to empty). **Phase 1b** (conditional, on `brief_should_revise`) builds `research_revision_task` and runs it in its own Crew; a `writer_research_task` variable holds the original `research_task` by default and is swapped to the revision task here. **`report_task` is built AFTER phase 1b** with `writer_research_task` as its research context, so the Writer reads the revised brief when one exists; `brief_critique_task` is still appended to the Writer's context at runtime so the Writer also sees the verdict. **Phase 1c** runs the Writer in its own Crew. **Phase 2** runs the Report Critic; `report_should_revise` uses the same substantiated-fail rule. **Phase 3** (conditional, on `report_should_revise`) runs `build_report_revision_task`; otherwise the phase-1c draft is used. Each loop runs at most once (no re-audit of revised output). Also includes a duplicated **No-DR bypass** (mirrors the same check in `ai.py`) as defense-in-depth, plus internal fence-stripping and `.pdf` reference extraction.
- **`agents/researcher.py`** — Agent 1, Clinical Evidence Researcher. Tools: `severity_classifier`, `guideline_retrieval`. Goal: produce an evidence brief (referral timeline, management steps, urgent triggers, follow-up intervals) plus a sources list.
- **`agents/brief_critic.py`** — Agent 2, Clinical Evidence Auditor. **No tools.** Uses `critic_llm`. Receives the Researcher's brief via `context=[research_task]` and emits a raw JSON verdict `{verdict, failed_checks, revision_instruction}`. Rubric flags: `missing_referral_timeline`, `missing_management_steps`, `missing_urgent_triggers`, `retrieval_failed`, `severity_mismatch`. A substantiated `fail` (verdict=fail AND non-empty failed_checks) triggers a one-time Researcher re-run (phase 1b); the verdict is also logged for observability, and the Writer sees it via the appended context. A `fail` with empty `failed_checks` is logged and treated as a pass.
- **`agents/writer.py`** — Agent 3, Clinical Report Writer. Tools: `patient_context`, `screening_history`, `diagnostic_assembler`, `doctor_lookup`, `report_persist`. Produces the six-section markdown report, persists via `report_persist`, then returns ONLY the markdown as its final answer (no JSON wrapping, no fences). Both the crew and the `summarise-rag-crew` endpoint defensively strip ```` ```markdown ```` fences and `"Final Answer:"` prefixes anyway.
- **`agents/report_critic.py`** — Agent 4, Clinical Report Quality Auditor. **No tools.** Uses `critic_llm`. Receives the Writer's draft via `context=[report_task]` and emits a raw JSON verdict `{verdict, failed_checks, revision_instruction}`. Rubric flags: `missing_section`, `no_risk_factor_linkage`, `followup_interval_mismatch`, `no_references_cited`, `generic_recommendations`. A substantiated `fail` verdict triggers phase 3.
- **`tasks/research_task.py`** — `build_research_task(screening_session_id)`. The Researcher's primary task — classify the worst-case condition via `severity_classifier`, retrieve guidelines via `guideline_retrieval`, and condense into a four-section brief + `Sources:` list.
- **`tasks/brief_critique_task.py`** — `build_brief_critique_task(research_task)`. Context: `[research_task]`. Expected output: raw JSON verdict (no fences, no prose).
- **`tasks/report_critique_task.py`** — `build_report_critique_task(report_task)`. Context: `[report_task]`. Expected output: raw JSON verdict.
- **`tasks/report_revision_task.py`** — `build_report_revision_task(screening_session_id, report_task, report_critique_task)`. Context: `[report_task, report_critique_task]`. Instructs the Writer to fix ONLY the flagged sections, call `report_persist` again, and return plain markdown.
- **`tasks/research_revision_task.py`** — `build_research_revision_task(screening_session_id, research_task, brief_critique_task)`. Context: `[research_task, brief_critique_task]`. `agent=researcher`. Instructs the Researcher to fix ONLY the issues named in the brief critique's `failed_checks` / `revision_instruction` (e.g. re-run `guideline_retrieval` on `retrieval_failed`, add the referral timeline on `missing_referral_timeline`), reuse `severity_classifier` / `guideline_retrieval` as needed, preserve untouched sections verbatim, and return the brief in the same four-section + `Sources:` format (with HIGHEST-PRIORITY escalation labelling preserved for the downstream Writer).
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
- `send_clinical_report(patient_name, patient_email, report_html, session_id, pdf_bytes=None, attachments=None)` — green-header **cover-letter** email for "Hospital Ampang Jaya" (prepared-for line, hospital name, today's date, short body, blue-bold do-not-reply disclaimer). The report body is **no longer embedded** — the full report is the **PDF attachment**. **Attachment selection** (priority): if `attachments` (a `list[tuple[filename, bytes]]`) is provided, each is encoded as `{"filename", "content": list(bytes)}` (the **same `list(bytes)` int-array encoding** as the single-attachment path — NOT base64) → enables **one email with multiple attachments** (e.g. report + MC at finalize); else if `pdf_bytes` is provided, the legacy single-attachment block runs verbatim (filename = sanitised patient name + `YYYY-MM-DD_HHMM`); else no attachments. Existing callers (`resend-report`, legacy `/send-report`) are unchanged. Subject is unique per report (`Your Clinical Report — {patient_name} ({DD Mon YYYY})`) to stop Gmail threading. `report_html` is now only used by the legacy `/send-report` path.
- `send_otp_email(to_email, to_name, otp_code)` — dark-themed OTP email for password reset (10-min expiry)

### `pdf_service.py`
`generate_report_pdf(patient_name, report_markdown, signature_data_url=None, doctor_name=None, physical_exam=None, prescription=None, clinical_impression=None, management_plan=None, follow_up_interval=None) -> bytes` — renders the clinical report markdown → HTML → PDF via **xhtml2pdf** (`pisa`). The report **letterhead is "Hospital Ampang Jaya"** (name only, no address; the "Clinical Report — {patient_name}" title line is kept). Before rendering, it **strips the trailing "Disclaimer" section** the CrewAI Writer appends from the report-body markdown — via `re.sub(r'\n#{0,6}\s*Disclaimer\b[\s\S]*$', '', ...)` on a **local copy** of `report_markdown`. This affects the **PDF/preview only**; `ai_results.rag_summary` in the DB, the API response, and the on-screen AI Clinical Summary card are unchanged (they still show the Disclaimer). Both `report-preview` and `finalize-review` inherit the strip since `generate_report_pdf` is the single choke point. If **any** assessment arg is truthy, a **"Doctor's Clinical Assessment"** section is inserted **after the AI report body and before the signature block**, ordered: Physical Examination (two-column Left/Right table, iterating a fixed label list and rendering only non-empty values; an "Other findings" line below the table) → Clinical Impression → Prescription (Drug/Dose/Frequency/Duration table, section skipped when empty). The assessment section **flows naturally after the report body — there is no forced page-break** (the earlier `page-break-before: always` wrapper was reverted). The signature block flows after the assessment. **Management Plan and Follow-up Interval sections were removed** from this rendering (the `management_plan`/`follow_up_interval` params are kept in the signature for backwards-compat but are unused/`None`). Interpolated values are `html.escape`d for xhtml2pdf safety. When `signature_data_url` (a `data:image/png;base64,...` URL) is provided, appends a certification block ("I hereby certify that I have reviewed this clinical report.", the base64 signature `<img>`, a signature line, the doctor name + "Reviewing Doctor") above the footer disclaimer; otherwise renders without it. The **footer disclaimer is a pisa repeating static frame**: the `@page` rule declares `@frame footer_frame` (`-pdf-frame-content: footerContent`) anchored to the bottom margin, and pisa pulls the `#footerContent` div's contents into it so the disclaimer prints at the **bottom of every page** (not just the last). The `@page` **bottom margin was enlarged to 3cm** (`margin: 2cm 2cm 3cm 2cm`) to reserve space so body text never overlaps the footer; the old single end-of-document `<div class="footer">` was removed (footer now lives only in the frame). The signature block and assessment section stay in normal document flow. (`generate_mc_pdf` is unchanged — its footer is still a single inline div.) Legacy callers passing only the original four args produce the same output as before (just the new letterhead). Used by `report-preview` and `finalize-review`.

`generate_mc_pdf(certificate_no, mc_date, patient_name, ic_passport, days, date_from, date_to, reason, signature_data_url=None, doctor_name=None, department=None) -> bytes` — renders a **bilingual (English / Bahasa Malaysia)** standard Malaysian **Medical Certificate** ("MEDICAL CERTIFICATE / SIJIL CUTI SAKIT") to PDF via xhtml2pdf. **Letterhead "Hospital Ampang Jaya"** (name only). Fields: Certificate No. (already-formatted 5-digit string from `mc_certificates.mc_number`), Date/Tarikh, Patient name/Nama, I/C No./No. K/P, Department/Jabatan (rendered only when `department` is provided), the unfit-for-duty sentence (EN + BM) with the day count, From/Dari + To/Hingga dates, Reason/Sebab, then the **shared `_build_signature_block(signature_data_url, doctor_name)`**. **No MMC No.** Dates (`mc_date`/`date_from`/`date_to`) are `YYYY-MM-DD` strings formatted to `DD Month YYYY` via `strptime` in a try/except (fallback to the raw string). All interpolated values are `html.escape`d.

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
`id, screening_session_id (FK), doctor_id (FK), decision (approved|overridden), final_grade_left, final_grade_right, override_reason, report_url, reviewed_at, physical_exam (jsonb), prescription (jsonb), clinical_impression, management_plan, follow_up_interval`
The last five columns persist the **Doctor's Clinical Assessment** and are written only by `finalize-review`. `physical_exam` is `{left, right, other_findings}`, `prescription` is a list of `{drug, dose, frequency, duration}`. **Note:** `management_plan` and `follow_up_interval` were removed from the assessment block UI/PDF — `finalize-review` still includes these keys in its insert but they now arrive `None`, so new rows store NULL for them; the columns are retained for already-finalized historical rows and for `follow_up_interval`'s other uses.

### `mc_certificates`
`id, mc_number (serial), screening_session_id (FK), patient_id (FK), doctor_id (FK), days, date_from, date_to, reason, mc_url, created_at`
Medical Certificates issued at `finalize-review` when `mc_issue` is true. The row is inserted **first** (to allocate the serial `mc_number`, zero-padded to 5 digits for the certificate number), then the PDF is generated/uploaded to the **`medical-certificates`** bucket (public, path `{id}.pdf`) and `mc_url` is back-filled. **Pre-existing table + bucket — do not recreate.**

### `appointments`
`id, patient_id (FK), scheduled_by (FK staff_users), assigned_doctor_id (FK), appointment_datetime, status (scheduled|completed|cancelled|no_show), notes, confirmation_sent_at, notification_sent_at, created_at`

### `password_reset_otps`
`id, email, otp_code, created_at, expires_at, used (bool)` — OTP records for self-service password reset. OTPs expire after 10 minutes; used OTPs are kept so the 15-min reset window can be validated. Index on `email`.

### `documents`
Vector store table — used by LangChain `SupabaseVectorStore`. Queried via the `match_documents` RPC function. Populated by `/ai/ingest-research`. RLS deny-by-default applies, and `execute` on `match_documents` is revoked from `anon`/`authenticated` — necessary because a SECURITY DEFINER function would otherwise read straight past the table policy. Retrieval is unaffected (the backend calls it as service role). A second RPC, **`match_ai_results`**, is exposed by PostgREST but referenced nowhere in this repo; it is revoked too.

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

### Form validation (`utils/validation.ts`)
Shared client-side form-field validators live in `src/utils/validation.ts`. Each function returns an **error-message string when invalid, or `null` when valid** (note: `null` = valid, the opposite of a boolean "is valid" flag). Exports: `validateEmail`, `validatePassword` (≥8 chars + upper + lower + digit + symbol), `validateRequiredPassword` (non-empty only — used on login where the full strength rules shouldn't apply), `validateConfirmPassword(pw, confirm)`, `validateName`, `validateIcPassport`, `validateAge` (integer 1–120), `validatePhone`. Consumed by `Login.tsx`, `Register.tsx`, `ForgotPassword.tsx`, `NurseDashboard.tsx` (new-patient form), and `AdminDashboard.tsx`. Added in the "input validation to auth and patient registration forms" commit.

The three **Admin** forms run the same validators on submit (before the API call, returning early on the first failure via `toast.error`), matching the Register/NewPatient rules: **Update User Name** → `validateName`; **Reset User Password** → `validatePassword` + `validateConfirmPassword`; **Update Patient** → `validateName` + `validateIcPassport` + `validatePhone` (Sex is read-only and not validated). These replaced the older ad-hoc inline checks (e.g. the previous "≥6 characters" password rule is now the stronger shared `validatePassword`).

**Admin confirm modals**: all five mutating admin actions — **Update User Name**, **Reset User Password**, **Delete User** (System Users tab) and **Update Patient**, **Delete Patient** (Patients tab) — now require a **Confirm/Cancel modal** before the API call fires. The modal is a lightweight in-file `ConfirmModal` (module-scope, fixed overlay + Tailwind; reused by both tabs via a single `ConfirmState` `{open, message, danger, confirmLabel, onConfirm}` state per tab and the `CLOSED_CONFIRM` constant). Destructive actions (delete user/patient) render a red Confirm button (`danger: true`); the rest use primary blue. Each handler is split: a synchronous opener runs client-side validation **first** (returns early via `toast.error` so the modal never opens on invalid input) then sets the confirm state; the actual `adminAPI` PATCH/DELETE call lives in a `do*` function passed as `onConfirm`. The two **delete** forms keep their existing "I understand…" checkbox as the **first** gate (button stays disabled until checked); the modal is a **second** confirmation that opens only after the enabled Delete button is clicked.

### Back/Forward sub-view navigation (`ViewNavArrows`)
Both NurseDashboard and DoctorDashboard render a **browser-style back/forward arrow row** (`src/components/ViewNavArrows.tsx`) directly below `<AppHeader>`, on **every** sub-view (including Nurse `home` / Doctor `inbox`). It navigates the user's **in-app sub-view history**, independent of the router/browser history API.
- Each dashboard's sub-view `useState` setter is renamed `applyView`; a wrapper `setView(next)` pushes the current view onto a `viewHistory` stack, clears `viewFuture`, then applies the new view. **All existing `setView(...)` call sites are unchanged** — they get history tracking automatically. `goBack`/`goForward` move views between the two stacks.
- The row is rendered **once per dashboard** in a single fixed location (a `flex-none` sibling between `<AppHeader>` and `<main>`); it is **not** duplicated per sub-view. Arrows are bold blue `ArrowLeft`/`ArrowRight` lucide icons (`size={18}`, `strokeWidth={3}`), back-on-left/forward-on-right, in `w-8 h-7` buttons on a `px-6 py-0.5` container.
- The row container has a **transparent background** (only `border-b border-gray-200`) — no `bg-white`/pill/box behind the arrows — so it looks identical on every view, sitting on plain white (the grid/net background is on `<main>`, **below** the row, so nothing patterned shows behind the arrows). The arrow buttons themselves have no persistent fill (`hover:bg-blue-50` on enabled hover only).
- Back is disabled (faded `opacity-40 cursor-not-allowed`) when `viewHistory` is empty; forward when `viewFuture` is empty — so on home/inbox both arrows are usually disabled. Disabled buttons set the `disabled` attribute.
- The old contextual in-header back buttons ("← Back to Patients", "← Back to Workspace", "← Back to Inbox", "← Back") were **removed** from both dashboards' `AppHeader` `leftSlot` (now only the hamburger toggle remains) since the arrow row supersedes them. The Nurse `returnTo` state and the Doctor `headerBackLabel` constant were removed as dead code; `handleReviewBack` is kept (still wired to `ReviewView`'s `onBack` and the approve/override return-to-origin flow).
- Deeper sub-views (those other than home/inbox originally) use `px-6 pt-3 pb-6` instead of `p-6` to keep content tight under the arrow row; Nurse `home` and Doctor `inbox` retain `p-6`.
- **Admin dashboard does NOT have the arrow row.**

### Grid/net background
A faint grid/net pattern sits behind **only the Nurse `home` (welcome/empty-state) view's main content**. It is applied via inline `style` on that dashboard's `<main>` element (scoped with `view.name === 'home' ? {...} : undefined`), **not** on the shared content column — so it sits **below** the arrow row (the row stays on plain white) and never appears behind the header. Style: `backgroundColor: '#f8fafc'` + two `linear-gradient` line layers at `rgba(15,23,42,0.07)`, `backgroundSize: '44px 44px'`.
- The **Doctor dashboard has no grid background** (it was added to the Doctor `inbox` `<main>` at one point, then removed — the Doctor inbox content area sits on a plain background).
- The Nurse `home` welcome card (white card with the people icon, intro text, and "+ Add New Patient" button) uses `rounded-2xl` + an inline soft elevated shadow `boxShadow: '0 24px 60px -12px rgba(15,23,42,0.22)'` (replacing the old `shadow-xl` class) so it clearly lifts off the grid.
- **Admin dashboard has no grid background.**

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
4. **review** — AI Verdict section with original/heatmap toggle (EyePanel), per-eye edit widgets, RAG report, and a **Doctor Actions** area. Raw retinal images are **not** shown as a separate section — they are accessible only via the heatmap toggle within AI Verdict. The old Override modal has been removed. For non-locked (`analysed`) sessions Doctor Actions is a single **Approve** button that launches the signature → preview → finalize flow (see below). For locked (`approved`/`overridden`, view-only) sessions it shows **Send Report to Patient** + **Export as PDF** plus a "This session is view-only…" notice.
5. **appointments** — calendar view of appointments assigned to this doctor

**Clear button — localStorage persistence**: cleared session IDs are stored under `visionary_doctor_cleared_{doctor_id}` (per-doctor). State is loaded into a `Set<string>` on mount and persisted on every change. On each `assignedSessions` refresh the cleared list is pruned of any IDs no longer present (e.g. session reassigned away). The list is intentionally never cleared on logout — closing/clearing localStorage is the only reset path.

**Return-to-origin after approve/override**: the `review` variant of `DoctorView` carries a `returnTo` field set when the user navigates in (`{ kind: 'inbox' }` from the inbox or `{ kind: 'patient-history', patient_id, patient_name }` from a patient-history view). After a successful Approve/Submit, `handleReviewBack` reads `returnTo` and navigates accordingly. (`handleReviewBack` is also passed to `ReviewView` as `onBack`. The old in-header "← Back" button was removed — see the Back/Forward sub-view navigation section above; the `ViewNavArrows` row now handles in-app back navigation.)

**Per-eye inline edit flow** (replaces the old Override button):
- Each eye widget has an **Edit** button (visible when session is not locked, but **disabled/greyed-out until a RAG report has been generated** — tooltip: "Generate Clinical Report Summary first"). The button uses a red/orange gradient style; when disabled it is `opacity-40 grayscale cursor-not-allowed`.
- Clicking Edit switches the widget into a 3-field form: Disease Detected, Disease Type, Severity. Severity options are driven by `getSeverityOptions(diseaseType, diseaseDetected)`.
- Clicking **Confirm** opens a custom `showOverrideConfirm` modal. On confirmation, calls `PATCH /ai/result/{id}`, updates local `aiResults` state, and collapses the widget to a post-edit summary with a "Doctor Edited" amber badge. Also clears `ragResult` locally (set to `null`) and shows a toast "Clinical summary cleared — click Regenerate to update it". The RAG section then shows a yellow "Needs Regeneration" card with a "Regenerate Clinical Summary" button instead of the previous report.
- The Doctor Actions button always **displays** as green "✅ Approve" regardless of edit state; the committed `decision` is computed from edit flags (any eye edited, OR the report text edited via `reportEdited`) → `overridden`, else `approved` (see the signature/finalize flow below). The legacy `POST /screenings/{id}/doctor-review` endpoint is no longer called by the UI — the signed `finalize-review` flow records the review.
- All edit state (`leftEditing`, `rightEditing`, `leftEdited`, `rightEdited`, `leftEditForm`, `rightEditForm`, `leftConfirmed`, `rightConfirmed`, `showOverrideConfirm`, `pendingConfirmEye`) resets when the doctor navigates to a different session.

**RAG report inline edit flow** (TipTap WYSIWYG):
- The AI Clinical Summary header shows an **Edit** button (red/orange gradient, same style as widget Edit buttons) when `ragResult` exists, the session is not locked, and `isEditingReport === false`.
- Clicking Edit enters edit mode by mounting `<RagReportEditor>` (`src/components/RagReportEditor.tsx`) — a TipTap editor with `StarterKit` + the `tiptap-markdown` extension. The editor parses the current `rag_summary` as markdown on mount and exposes `getMarkdown()` via a `forwardRef` handle so the parent can pull serialized markdown back out. Toolbar buttons cover H3 / Bold / Italic / Bullet / Numbered list / Undo / Redo. The editor surface is styled (h3 17px medium, bold labels, tight lists) to match the view-mode markdown layout.
- Clicking **Cancel** exits edit mode without saving; the Edit button reappears.
- Clicking **Confirm** opens a `showSaveReportConfirm` modal. On confirmation, reads markdown via `reportEditorRef.current?.getMarkdown()`, calls `PATCH /ai/rag-summary/{session_id}` via `aiAPI.updateRagSummary`, and updates local `ragResult`.
- Edit state (`isEditingReport`, `showSaveReportConfirm`, `reportEditorRef`) resets when the doctor navigates to a different session. The `<RagReportEditor key={sessionId} />` key forces a fresh editor instance per session so its content reflects the new report. A successful report-text save also sets `reportEdited = true`, which makes the eventual finalize commit an `overridden` decision.

**Doctor's Clinical Assessment block** (`src/components/DoctorClinicalAssessment.tsx`): a fully **controlled**, **condition-aware** documentation block rendered in `ReviewView` between the AI Clinical Summary card and the Doctor Actions section, **only when `ragResult || isLocked`** (i.e. after the doctor clicks "Generate Clinical Report Summary", or on a locked/read-only session) — it does **not** appear before a RAG summary exists. Because the block only mounts once `ragResult` exists, the `enabled={false}` greyed/overlay path is effectively unreachable for live sessions (kept in the component for safety, normally not shown). The parent owns the state — `assessment: AssessmentData` in `ReviewView`, reset on session change in the big `[sessionId, refreshKey]` reset effect. **Persistence is wired (incl. MC)**: `handleSignatureConfirm` (preview) and `handleFinalize` (commit) send `physical_exam` (`{left, right, other_findings}`), `prescription`, `clinical_impression` to `report-preview`/`finalize-review`; `finalize-review` persists them to `doctor_reviews` and `generate_report_pdf` renders them into the PDF. **Management Plan and Follow-up Interval were removed from this block** (UI, finalize payload, and report PDF section) — the `doctor_reviews.management_plan`/`follow_up_interval` columns are retained (for already-finalized historical rows, and `follow_up_interval`'s other uses) but are no longer written by this block (they arrive `None`); `extractRecommendedManagement` and the touched-guard pre-fill effect were deleted. The **MC** fields (`mc_issue`/`mc_days`/`mc_date_from`/`mc_date_to`/`mc_reason`, sourced from `assessment.mc`, days coerced to a number) are sent on `handleFinalize` **only** (not preview); when `mc_issue` the backend generates + stores the MC and emails it alongside the report. The latest MC row is fetched in `load()` **always** (via `screeningsAPI.getLatestMc`) into `mcRow` (reset in the big effect) so a just-finalized session shows its MC immediately, and is passed to the component as `mcReadOnly`. Sections (renumbered after the Management Plan / Follow-up removal): (1) **Physical Examination** — two columns (Left/Right) keyed off `resolveCondition(leftRes/rightRes)` (prefer `disease_type`, else map `dr_severity` — mirrors the EyePanel resolver): core fields always (Visual Acuity, Slit-Lamp, IOP), plus Gonioscopy/Cup-Disc/Visual-Field (Glaucoma), Dilated Fundus/Macular Edema (DR), or Lens Opacity/Density/Glare (Cataract); + a full-width Other-findings catch-all; (2) **Clinical Impression** — documentation only, never alters the AI verdict; (3) **Prescription** — 0..N repeatable drug·dose·frequency·duration rows; (4) **Medical Certificate** — toggle revealing days/from/to/reason. **Lenient approve gate** (`assessmentGateError()` called at the top of both `handleApprove` and `handleSubmit`, and folded into the Approve buttons' `disabled`/`title` via `assessmentError`): require IOP (≥1 eye) when any eye is Glaucoma, Visual Acuity (≥1 eye) when DR or Cataract, a non-empty Clinical Impression always, and all MC fields when the MC toggle is on. **Required-field affordances** (visual hints only — they mirror, and do NOT drive, that gate): a red `*` marker (`Req`) on Visual Acuity (both columns, when `needVA` = either eye is DR/Cataract), IOP (both columns, when `needIOP` = either eye Glaucoma), Clinical Impression (always), and the MC Days/From/To/Reason labels (when the MC toggle is on); plus a dynamic gray helper line under the "1. Physical Examination" heading (`Required to approve: enter Visual Acuity and/or IOP for at least one eye, plus a Clinical Impression.`), shown only when `enabled`. These mirror the gate exactly and appear only in the interactive form, never in read-only mode. **enabled** = `ragResult && !isLocked` (greyed `opacity-40 grayscale pointer-events-none` with a "Generate Clinical Report Summary first" overlay otherwise); **readOnly** on locked sessions renders saved values as label:value text reconstructed from `latestReview` (`physical_exam`/`clinical_impression`/`prescription` read defensively via `as unknown as Record<string, unknown>` since these columns aren't on the `DoctorReview` TS type), with `mcReadOnly={mcRow ? {...} : null}` (the MC summary — Certificate No. zero-padded, days, from/to, reason — rendered read-only from the fetched `mc_certificates` row). The block is purely additive — it does **not** affect the override decision (still `overridden` only when `leftEdited || rightEdited || reportEdited`).

**Doctor signature → preview → finalize flow** (replaces the old direct Approve/Submit commit and the old "Send Report to Patient" inline button + `showSendConfirm` modal):
- Clicking **Approve** sets `pendingDecision` (`overridden` if any eye OR the report was edited, else `approved`) and opens a 3-step modal sequence. The actual commit happens only at the end.
- **Modal 1 — Signature**: a `react-signature-canvas` pad ("I hereby certify…"). Confirm (disabled/blurred until a stroke exists) captures a PNG data URL and calls `screeningsAPI.reportPreview(...)` → receives a PDF blob. **If an MC is being issued** (`assessment.mc.enabled`), it ALSO calls `screeningsAPI.mcPreview(...)` (placeholder cert no "PREVIEW", no DB write) and stores the MC preview blob/`{data}`/URL.
- **Modal 2 — Preview**: renders the PDF with `react-pdf` (PDF.js worker pinned to cdnjs `pdf.js/4.4.168`; the `<Document file>` is fed the **blob URL** (`previewPdfUrl` / `mcPreviewUrl` from `URL.createObjectURL`), NOT an in-memory `{ data: Uint8Array }` — PDF.js detaches/transfers the ArrayBuffer on first render, so reusing a `{data}` object across tab re-mounts caused "Failed to load PDF file"; a URL string is stable and not consumed. **All** pages render onto canvas via the `onLoadSuccess` page count), plus an "Open PDF in new tab" link. **When an MC was issued, a "Report" / "Medical Certificate" tab switcher** (local `previewTab`, default `report`, reset on open; tab bar shown when `mcPreviewUrl` is non-null) appears at the top of the modal body — the active tab renders its own `react-pdf` Document (report `previewPdfUrl`/`numPages` vs MC `mcPreviewUrl`/`mcNumPages`), and the "Open PDF in new tab" link points to the active tab's blob URL. When no MC was issued there is **no tab bar** (report only). Asks "Send this report to the patient?" → **No, just save** / **Yes, send to patient** (both → final confirm); **Back** returns to the signature pad (preview blob URLs are kept alive until finalize, only revoked at the very end).
- **Modal 3 — Confirm**: calls `screeningsAPI.finalizeReview(...)` — the single commit (PDF → `reports` bucket, status, `doctor_reviews` row + `report_url`, optional email; MC generated/stored when `mc_issue`). `send_to_patient` is forced false when there is no patient email. On success it triggers a local download of the report PDF **and**, when an MC was previewed, the MC PDF (`{name}_{stamp}_MC.pdf`) — note the auto-downloaded MC is the **preview copy** (placeholder cert no); the authoritative MC with the real 5-digit number lives in the `medical-certificates` bucket (download via Export MC). Then runs the return-to-origin redirect. `override_reason` is built from what was edited: `"Doctor manually edited AI results and the clinical report."` (either/both).
- **View-only Doctor Actions** (`approved`/`overridden`): **Send Report to Patient** (blue) opens `showResendConfirm` → `screeningsAPI.resendReport(...)` (re-emails the saved PDF; or shows "No patient email on record."); **Export as PDF** (neutral) calls `screeningsAPI.downloadReportPdf(...)` and downloads the stored PDF (same filename pattern); **Export MC as PDF** (neutral, shown **only when `mcRow` exists**) calls `screeningsAPI.downloadMcPdf(...)` → `handleExportMc` and downloads the stored authoritative MC (`{name}_{stamp}_MC.pdf`, real cert no). A muted notice states the session is finalized/view-only.
- All signature-flow state (`showSignatureModal`, `showPreviewModal`, `showFinalConfirm`, `signatureEmpty`, `previewPdfUrl`, `numPages`, `mcPreviewUrl`, `mcNumPages`, `previewTab`, `pendingDecision`, `sendToPatient`, `flowLoading`, `signatureDataUrl`, `reportEdited`, `showResendConfirm`, `resendLoading`, `exportLoading`, `exportMcLoading`) resets when the doctor navigates to a different session (the two preview blob URLs are revoked on reset).

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

### Critic verdicts — "fail" requires non-empty `failed_checks`
Both critics emit `{verdict, failed_checks, revision_instruction}`. A revision loop fires only on a **substantiated** fail: `verdict == "fail"` AND `failed_checks` is a non-empty list. This is deliberate — gpt-4o-mini critics occasionally return `{"verdict": "fail", "failed_checks": []}` (a fail with nothing named), which previously triggered a spurious revision that "fixed" a non-problem. The guard in `crew.py` coerces a missing/non-list `failed_checks` to empty and treats the empty-checks case as a pass (logged, no revision). Apply the same `verdict=="fail" and len(failed_checks) > 0` rule to any future critic loop. This applies to both the Brief Critic (gating the phase-1b Researcher re-run) and the Report Critic (gating the phase-3 Writer revision).

### Glaucoma/IOP column names — RAG reads wrong columns — FIXED
This bug is now **FIXED** in both pipelines. Previously the original `generate_rag_summary` read the glaucoma/IOP patient fields under the wrong column names (`family_history_glaucoma` / `elevated_iop`), so the RAG report always showed "Unknown" for them. The CrewAI `patient_context` tool (`backend/agents/tools/patient_context.py`) now correctly reads `glaucoma_family_history` and `elevated_iop_history` from the `patients` table.

### `RetinalImage.created_at` vs `uploaded_at`
The `retinal_images` table column is `uploaded_at` (set in `uploads.py:151`). The TypeScript `RetinalImage` interface declares `created_at: string` instead. Read defensively if you need the timestamp from this row.

### Stored URL columns are stale by design — never render or fetch them directly
`retinal_images.image_url`, `ai_results.heatmap_url`, `doctor_reviews.report_url`, and `mc_certificates.mc_url` all still hold the **public** URL written at upload time. Those are kept deliberately, as stable identifiers that `path_from_public_url()` parses — but they are **historical records, not live links**, and they stop resolving the moment their bucket is private.

Every read path re-derives a working URL instead:
- serving a URL to the frontend → `signed_url(bucket, path)` from `backend/storage_utils.py`
- fetching bytes server-side → `download_bytes(bucket, path)`, or `_fetch_stored_pdf(...)` in `screenings.py`

New code that does `<img src={row.image_url}>` or `requests.get(row.report_url)` will appear to work today and break the instant the buckets are flipped. This is the single easiest mistake to make in this codebase now.

### Frontend coverage gaps
- `aiAPI` does **not** expose `/ai/evaluate-rag` or `/ai/rag-trace` — these are backend-only / FYP-evaluation endpoints called via direct HTTP (e.g. curl or test scripts), not from the React app.
- `aiAPI` **does** expose `reanalyze(sessionId)` — calls `POST /ai/reanalyze/{id}`. It exists in `api.ts` but is not triggered from the nurse/doctor UI (admin/debug only).
- `aiAPI.summariseRAGCrew(sessionId)` — calls `POST /ai/summarise-rag-crew`, the **live** RAG endpoint used by the doctor review screen.
- `aiAPI.summariseRAG(sessionId)` — still exported, but the backing endpoint `/ai/summarise-rag` is disabled (commented out in `ai.py`). Calling it will 404. Use `summariseRAGCrew` instead.
- `aiAPI.updateRagSummary(sessionId, ragSummary)` — calls `PATCH /ai/rag-summary/{id}`, used by the doctor TipTap report editor.
- `screeningsAPI.reportPreview(sessionId, payload)` — `POST /screenings/sessions/{id}/report-preview`, `responseType: 'blob'` (signed PDF preview, no DB write).
- `screeningsAPI.mcPreview(sessionId, payload)` — `POST /screenings/sessions/{id}/mc-preview`, `responseType: 'blob'` (MC PDF preview, placeholder cert no, no DB write).
- `screeningsAPI.finalizeReview(sessionId, payload)` — `POST /screenings/sessions/{id}/finalize-review` (the signed-review commit).
- `screeningsAPI.resendReport(sessionId, {patient_name, patient_email})` — `POST /screenings/sessions/{id}/resend-report` (re-email the saved PDF).
- `screeningsAPI.downloadReportPdf(sessionId)` — `GET /screenings/sessions/{id}/report-pdf`, `responseType: 'blob'` (download the saved PDF).
- `screeningsAPI.downloadMcPdf(sessionId)` — `GET /screenings/sessions/{id}/mc-pdf`, `responseType: 'blob'` (download the saved authoritative MC PDF).
- `screeningsAPI.getLatestMc(sessionId)` — `GET /screenings/sessions/{id}/mc-certificate/latest` (latest `mc_certificates` row or `null`, for the read-only MC display).
- `screeningsAPI.sendReport(...)` — legacy `/send-report`; still exported but no longer called by the review UI (superseded by the signature flow).

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
- **`POST /screenings/sessions/{id}/report-preview`** and **`GET /screenings/sessions/{id}/report-pdf`** stream raw PDF bytes (`application/pdf`), not a JSON wrapper.
- **`POST /screenings/sessions/{id}/finalize-review`** returns `{success, report_url, emailed}`; **`POST /screenings/sessions/{id}/resend-report`** returns `{success: true}`.
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
- **All Storage access goes through `backend/storage_utils.py`** — `signed_url()` to hand a URL to the frontend, `download_bytes()` to read a file server-side. Never `get_public_url()` on a read path and never `requests.get()` on a stored URL column; both work today and break when the buckets are flipped private. Writes may still store the public URL as a stable identifier. See "Stored URL columns are stale by design".
- **SQL in `supabase/migrations/` is never executed by code** — no migration runner is wired up, and `supabase/` is not a Supabase CLI project. Files there are written to be idempotent and pasted into the Supabase SQL editor by hand. Adding a file changes nothing until someone runs it, so never treat its contents as the live database state — verify with the queries in the file's verification section.
- **RLS is on, and the backend does not notice** — the service role bypasses it. Do not "fix" a failing query by loosening a policy: if the backend gets a permission error, the cause is something other than RLS. Conversely, a query succeeding proves nothing about whether anon is blocked; test that with the anon key directly.
- **No file-based frontend build step needed in dev** — `npm run dev` serves the React app directly via Vite.
- **Tailwind CSS** is used throughout the frontend (dark theme, `bg-[#0b0f14]` is the base background color).
- **react-hot-toast** is used for all notifications (top-right, 4s, dark styled).
- **Long-list pagination** — Lists that can exceed 15 items use the shared `<Pagination>` component (`src/components/Pagination.tsx`). It renders only when `totalItems > 15`, shows 15 per page, includes Prev/Next arrows + numbered pages with ellipsis compression beyond 7 pages, and smooth-scrolls to the table top on page change. Currently applied to: Doctor Inbox, Doctor Patient History, Doctor All Patients, Nurse All Patients, Nurse Workspace screening sessions (all 15/page), and Admin System Users + Admin All Patients (10/page).
- **App header with home shortcut** — All three dashboards render an `<AppHeader>` component (`src/components/AppHeader.tsx`) at the top of their main content area. It contains a "Visionary AI" logo (inline SVG eye + wordmark) that, when clicked, returns the user to their dashboard's home view (Nurse → `home`, Doctor → `inbox`, Admin → `users`). The component accepts optional `leftSlot` and `rightSlot` props so dashboards can host the hamburger toggle (left) and user/sign-out controls (right) inside the same bar. (The contextual "← Back to …" buttons that used to live in `leftSlot` were removed — in-app back navigation is now handled by the `ViewNavArrows` row rendered below the header; see the Back/Forward sub-view navigation section.) On DoctorDashboard, if the TipTap RAG editor has unsaved changes (`isEditingReport === true`), clicking the logo opens a confirmation modal (`showLogoLeaveConfirm`) before navigating; per-eye edits and other in-progress states do not trigger this guard. `isEditingReport` is lifted to the `DoctorDashboard` level (controlled prop into `ReviewView`) so the logo handler can read it. **Refresh-in-place**: clicking the logo while **already on the main view** (Doctor `inbox` / Nurse `home`) refreshes that view's data in place instead of re-navigating — Doctor bumps a `mainRefreshKey` (remounts `InboxView` to refetch + re-runs the `assignedSessions` fetch) and clears the sidebar search; Nurse bumps `patientListKey` (refetches the patient list) and clears the sidebar search. It does **not** call `window.location.reload()`. (Admin is unchanged.)