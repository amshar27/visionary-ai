# Visionary AI

A clinical-grade multi-disease retinal screening system built for Malaysian healthcare. Nurses upload retinal fundus images, an AI model detects disease, and doctors review AI results to generate and approve clinical reports sent to patients via email.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python), uvicorn, port **8000** |
| Frontend | React 19 + TypeScript (Vite), port **5173** |
| Database | Supabase (PostgreSQL + Object Storage + pgvector) |
| AI Model | PyTorch — ResNet152 + MultiheadAttention, 5 DR classes, Grad-CAM heatmaps |
| LLM / RAG | GPT-4o-mini (per-eye summaries), GPT-4o (full clinical report), LangChain + Supabase vector store |
| Email | Resend — appointment confirmation, 24-hour reminder, clinical report delivery |

---

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- A `.env` file in the project root with:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_key
RESEND_API_KEY=your_resend_key
```

### Install dependencies

```bash
# Backend
pip install -r requirements.txt

# Frontend
cd frontend-react && npm install
```

### Run the application

```bash
# Backend (from project root)
uvicorn backend.main:app --reload --port 8000

# Frontend (in a separate terminal)
cd frontend-react && npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## User Roles & Workflow

### Nurse
1. Register or search for a patient
2. Create a screening session
3. Upload left and right retinal fundus images
4. Trigger AI analysis
5. Assign session to a doctor

### Doctor
1. View assigned sessions in the inbox
2. Inspect AI results and Grad-CAM heatmaps
3. Generate a RAG-powered clinical report
4. Approve or override the AI findings
5. Send the report to the patient via email

### Admin
- Manage staff accounts (create, update name/password, delete)
- Manage patient records (update, delete)

---

## Project Structure

```
visionary_ai/
├── backend/
│   ├── main.py                  # FastAPI app, CORS, router registration
│   ├── db.py                    # Supabase client
│   ├── auth.py                  # Login / register
│   ├── patients.py              # Patient CRUD
│   ├── screenings.py            # Screening session workflow
│   ├── uploads.py               # Retinal image upload
│   ├── ai.py                    # AI inference, Grad-CAM, RAG report
│   ├── staff.py                 # Doctor listing
│   ├── admin.py                 # Admin staff/patient management
│   ├── appointments.py          # Appointment booking
│   ├── scheduler.py             # APScheduler jobs (reminders, no-show)
│   ├── notification_service.py  # Resend email helpers
│   └── model/
│       └── best_model.pth       # Trained PyTorch model weights
├── frontend-react/
│   └── src/
│       ├── pages/               # NurseDashboard, DoctorDashboard, AdminDashboard, etc.
│       ├── components/          # ProtectedRoute
│       ├── context/             # AuthContext (localStorage session)
│       ├── services/api.ts      # Axios API client
│       ├── types/index.ts       # TypeScript interfaces
│       └── utils/format.ts      # Formatting helpers
├── upload_paper.py              # One-time script: ingest research PDFs into vector store
├── requirements.txt
└── CLAUDE.md                    # Full developer reference (architecture, conventions, gotchas)
```

---

## AI Pipeline

The AI model (`ResNetWithAttention`) classifies retinal images into 5 diabetic retinopathy severity classes:

| Class | Label |
|---|---|
| 0 | No DR |
| 1 | Mild |
| 2 | Moderate |
| 3 | Severe |
| 4 | Proliferative DR |

After classification, Grad-CAM generates a heatmap overlay highlighting the regions that influenced the prediction. A GPT-4o-mini one-line summary is produced per eye. When the doctor triggers report generation, GPT-4o produces a full structured clinical report grounded in retrieved research documents (RAG via pgvector).

---

## Session Status Flow

```
pending → assigned → analysed → approved
                              → overridden
```

- **Re-upload / re-analyse**: blocked once `assigned`, `approved`, or `overridden`
- **Reassign doctor**: blocked only when `approved` or `overridden`
- **Doctor actions**: locked when already `approved` or `overridden`

---

## Developer Notes

- Auth uses bcrypt with no JWT — the user object is stored in `localStorage` under key `visionary_user`.
- CORS is set for `http://localhost:5173` and `http://127.0.0.1:5173`. Restart uvicorn after any CORS changes.
- Full architecture reference, database schema, API routes, UI conventions, and known issues are documented in [CLAUDE.md](./CLAUDE.md).
