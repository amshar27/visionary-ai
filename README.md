# Visionary AI

A clinical-grade multi-disease retinal screening system built for Malaysian healthcare. Nurses upload retinal fundus images, an AI model detects disease, and doctors review AI results to generate and approve clinical reports sent to patients via email.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python), uvicorn, port **8000** |
| Frontend | React 19 + TypeScript (Vite), port **5173** |
| Database | Supabase (PostgreSQL + Object Storage + pgvector) |
| AI Model | PyTorch — ResNet152 + MultiheadAttention, 7 classes (DR severity, cataract, glaucoma), Grad-CAM heatmaps |
| LLM / RAG | GPT-4o-mini (per-eye summaries), GPT-4o (full clinical report), LangChain + Supabase vector store |
| Multi-Agent Pipeline | CrewAI — four agents: Researcher (gpt-4o-mini) + Brief Critic (gpt-4o-mini) + Writer (gpt-4o) + Report Critic (gpt-4o-mini), with two conditional revision loops |
| PDF generation | xhtml2pdf — signed clinical report + bilingual medical certificate, with a repeating per-page disclaimer footer |
| Email | Resend — appointment confirmation, 24-hour reminder, clinical report (PDF attachment) delivery |

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
3. Generate a clinical report via a CrewAI multi-agent pipeline (Researcher → Brief Critic → Writer → Report Critic, with conditional revision loops)
4. Edit AI findings per-eye and the report inline (TipTap), and document a clinical assessment (physical exam, impression, prescription)
5. Sign the report (canvas signature), preview the generated PDF, then finalise — the signed PDF is stored and emailed to the patient, optionally with a medical certificate

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
│   ├── ai.py                    # AI inference, Grad-CAM, multi-agent RAG report
│   ├── staff.py                 # Doctor listing
│   ├── admin.py                 # Admin staff/patient management
│   ├── appointments.py          # Appointment booking
│   ├── scheduler.py             # APScheduler jobs (reminders, no-show)
│   ├── notification_service.py  # Resend email helpers
│   ├── pdf_service.py           # Clinical report + medical certificate PDF generation
│   ├── agents/                  # CrewAI four-agent RAG pipeline (researcher, critics, writer)
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
└── requirements.txt
```

---

## AI Pipeline

The AI model (`ResNetWithAttention`) classifies retinal images into 7 classes (diabetic retinopathy severity, cataract, and glaucoma):

| Class | Label |
|---|---|
| 0 | No DR |
| 1 | Mild |
| 2 | Moderate |
| 3 | Severe |
| 4 | Proliferative DR |
| 5 | Cataract |
| 6 | Glaucoma |

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
- The clinical report PDF (`pdf_service.py`) renders the on-screen disclaimer in a **pisa repeating static frame**, so it prints at the bottom of every page; the same disclaimer remains visible on the on-screen AI Clinical Summary card but is stripped from the PDF body to avoid duplication.

