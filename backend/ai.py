import torch
import torch.nn as nn
import io
import math
import requests
import re
from PIL import Image
from torchvision import models, transforms
from torchvision.models import ResNet152_Weights
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel as PydanticBaseModel
from uuid import UUID
from typing import Dict, List
import logging
from .db import supabase
from openai import OpenAI
import os
import tempfile
import cv2
import numpy as np
from pytorch_grad_cam import GradCAM
from pytorch_grad_cam.utils.image import show_cam_on_image
from pytorch_grad_cam.utils.model_targets import ClassifierOutputTarget
# RAG IMPORTS
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings, ChatOpenAI, ChatOpenAI as LCChatOpenAI
from langchain_community.vectorstores import SupabaseVectorStore
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough

# RAGAS imports are deferred — evaluate-rag is never called from the frontend.
# They are loaded lazily inside evaluate_rag() on first call.
_ragas_loaded = False
_ragas_evaluate = None
_ragas_metrics = None
_context_metric_name = "context_precision"
_ragas_llm = None
_ragas_embeddings = None

client = OpenAI()
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")

# Initialize Vector Store
vector_store = SupabaseVectorStore(
    client=supabase,
    embedding=embeddings,
    table_name="documents",
    query_name="match_documents",
)

router = APIRouter(prefix="/ai", tags=["ai"])

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.info(f"RAGAS context metric (will be loaded lazily): {_context_metric_name}")

LOCKED_STATUSES = {"assigned", "approved", "overridden"}

# ======================================================
# MODEL CONFIGURATION
# ======================================================
NUM_CLASSES = 7
ATTENTION_DIM = 512
NUM_HEADS = 8
CLASSES = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative DR', 'Cataract', 'Glaucoma']

DISEASE_SEVERITY_MAP = {
    'No DR': 'none',
    'Mild': 'mild',
    'Moderate': 'moderate',
    'Severe': 'severe',
    'Proliferative DR': 'proliferative',
    'Cataract': 'cataract',
    'Glaucoma': 'glaucoma'
}

# Standardized template returned when the CNN predicts No DR for both eyes.
# Bypasses the RAG pipeline since "management guidelines for absence of disease"
# is not a meaningful retrieval query.
NORMAL_SCREENING_TEMPLATE = """### Routine Screening Result

The AI screening did not detect signs of diabetic retinopathy, cataract, or glaucoma in either eye.

**Diagnostic Summary**
Both eyes screened as **No DR**. No referable findings detected.

**Recommended Management**
- No specialist referral indicated at this time.
- Continue routine annual diabetic eye screening per Malaysian Clinical Practice Guidelines (12-month follow-up interval).
- Advise the patient to report any new visual symptoms (blurring, floaters, sudden vision loss) promptly.

**Disclaimer**
This is an AI-assisted screening result. Clinical correlation by an attending ophthalmologist is recommended for final assessment.
"""

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
logger.info(f"Using device: {device}")

test_transform = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                         std=[0.229, 0.224, 0.225])
])

# ======================================================
# MODEL DEFINITION
# ======================================================
class ResNetWithAttention(nn.Module):
    def __init__(self, num_classes=NUM_CLASSES, attention_dim=ATTENTION_DIM, num_heads=NUM_HEADS):
        super(ResNetWithAttention, self).__init__()
        self.backbone = models.resnet152(weights=ResNet152_Weights.DEFAULT)
        self.backbone = nn.Sequential(*list(self.backbone.children())[:-2])
        self.feature_dim = 2048
        self.attention = nn.MultiheadAttention(embed_dim=self.feature_dim, num_heads=num_heads)
        self.fc = nn.Linear(self.feature_dim, num_classes)

    def forward(self, x):
        features = self.backbone(x)
        batch_size, num_features, height, width = features.size()
        features = features.view(batch_size, num_features, -1).permute(2, 0, 1)
        attention_out, _ = self.attention(features, features, features)
        attention_out = attention_out.mean(dim=0)
        out = self.fc(attention_out)
        return out

# ======================================================
# MODEL LOADING
# ======================================================
model = None

def load_model():
    global model
    try:
        model = ResNetWithAttention(num_classes=NUM_CLASSES).to(device)
        model.load_state_dict(torch.load('backend/model/best_model.pth', map_location=device))
        model.eval()
        logger.info("✅ Model loaded successfully")
    except Exception as e:
        logger.error(f"❌ Error loading model: {str(e)}")
        raise

try:
    load_model()
except Exception as e:
    logger.warning(f"Model not loaded on startup: {e}")

# ======================================================
# HELPER FUNCTIONS
# ======================================================
def download_image_from_supabase(image_url: str) -> Image.Image:
    try:
        response = requests.get(image_url, timeout=30)
        response.raise_for_status()
        image = Image.open(io.BytesIO(response.content)).convert('RGB')
        return image
    except Exception as e:
        logger.error(f"Failed to download image from {image_url}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to download image: {e}")


def predict_image(image: Image.Image) -> Dict:
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    try:
        image_tensor = test_transform(image).unsqueeze(0).to(device)

        with torch.no_grad():
            outputs = model(image_tensor)
            probabilities = torch.nn.functional.softmax(outputs, dim=1)
            confidence, predicted = torch.max(probabilities, 1)

        predicted_idx = predicted.item()
        predicted_class = CLASSES[predicted_idx]
        confidence_score = float(confidence.item())

        class_probs = {
            CLASSES[i]: float(probabilities[0][i].item())
            for i in range(NUM_CLASSES)
        }

        dr_presence = predicted_idx > 0
        referable = predicted_idx >= 2

        dr_severity = DISEASE_SEVERITY_MAP[predicted_class]

        follow_up_map = {
            'none': '12 months',
            'mild': '12 months',
            'moderate': '6 months',
            'severe': '3 months',
            'proliferative': '1 month',
            'cataract': 'Refer to specialist for evaluation',
            'glaucoma': 'Urgent specialist referral'
        }
        follow_up_interval = follow_up_map.get(dr_severity, 'TBD')

        warnings = []
        if referable:
            warnings.append(f"Referable condition detected ({predicted_class}) - specialist referral recommended")

        if predicted_idx == 4:
            warnings.append("Proliferative diabetic retinopathy - immediate referral required")
        elif predicted_idx == 5:
            warnings.append("Cataract detected - comprehensive eye exam recommended")
        elif predicted_idx == 6:
            warnings.append("Glaucoma suspect - urgent visual field and IOP testing recommended")

        if confidence_score < 0.7:
            warnings.append("Low confidence prediction - manual review recommended")

        llm_summary = generate_summary(predicted_class, confidence_score, dr_presence, referable)

        return {
            "predicted_class": predicted_class,
            "dr_severity": dr_severity,
            "dr_presence": dr_presence,
            "referable": referable,
            "confidence_score": confidence_score,
            "class_probabilities": class_probs,
            "follow_up_interval": follow_up_interval,
            "warnings": warnings,
            "llm_summary": llm_summary,
            "macular_involvement": "no"
        }

    except Exception as e:
        logger.error(f"Prediction error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


def generate_summary(predicted_class: str, confidence: float, dr_presence: bool, referable: bool) -> str:
    try:
        system_msg = "You are an expert ophthalmologist AI. Write a concise, professional 1-sentence summary for a patient screening report."

        user_msg = f"""
        Results:
        - Diagnosis: {predicted_class}
        - Confidence: {confidence:.1%}
        - Action Required: {'Refer to specialist' if referable else 'Routine monitoring'}
        
        Write a summary stating the detection and the recommended action.
        """

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg}
            ],
            temperature=0.3,
            max_tokens=200
        )

        return response.choices[0].message.content.strip()

    except Exception as e:
        logger.error(f"Summary Error: {e}")
        return f"AI Diagnosis: {predicted_class} ({confidence:.1%}). Please consult a doctor."


def generate_heatmap(image_tensor, original_image_pil, predicted_class_idx):
    try:
        target_layers = [model.backbone[-1][-1]]
        cam = GradCAM(model=model, target_layers=target_layers)
        targets = [ClassifierOutputTarget(predicted_class_idx)]
        grayscale_cam = cam(input_tensor=image_tensor, targets=targets)
        grayscale_cam = grayscale_cam[0, :]

        img_resized = original_image_pil.resize((224, 224))
        rgb_img = np.float32(img_resized) / 255

        visualization = show_cam_on_image(rgb_img, grayscale_cam, use_rgb=True)
        result_image = Image.fromarray(visualization)
        return result_image

    except Exception as e:
        logger.error(f"Heatmap generation failed: {e}")
        return None


# ======================================================
# API ENDPOINTS
# ======================================================
@router.post("/analyze")
def analyze(screening_session_id: UUID):
    s = (
        supabase.table("screening_sessions")
        .select("*")
        .eq("id", str(screening_session_id))
        .execute()
    )
    if not s.data:
        raise HTTPException(status_code=404, detail="Screening session not found")

    session = s.data[0]
    status = (session.get("status") or "").lower()

    if status in LOCKED_STATUSES:
        raise HTTPException(
            status_code=403,
            detail=f"Session locked (status={status})."
        )

    imgs = (
        supabase.table("retinal_images")
        .select("eye_side, image_url, id")
        .eq("screening_session_id", str(screening_session_id))
        .execute()
    )

    if not imgs.data:
        raise HTTPException(
            status_code=400,
            detail="No images found for this screening session."
        )

    eye_sides = {(r.get("eye_side") or "").lower() for r in imgs.data}
    if not {"left", "right"}.issubset(eye_sides):
        raise HTTPException(
            status_code=400,
            detail="Both left and right images are required before analysis."
        )

    results = []

    for img_record in imgs.data:
        eye_side = (img_record.get("eye_side") or "").lower()
        image_url = img_record.get("image_url")

        if not image_url:
            logger.warning(f"No image URL for {eye_side} eye")
            continue

        try:
            logger.info(f"Processing {eye_side} eye image: {image_url}")
            image = download_image_from_supabase(image_url)

            prediction = predict_image(image)

            heatmap_url = None
            try:
                image_tensor = test_transform(image).unsqueeze(0).to(device)
                predicted_class_str = prediction["predicted_class"]
                predicted_idx = CLASSES.index(predicted_class_str)

                heatmap_img = generate_heatmap(image_tensor, image, predicted_idx)

                if heatmap_img:
                    buf = io.BytesIO()
                    heatmap_img.save(buf, format='JPEG')
                    buf.seek(0)
                    file_bytes = buf.read()

                    heatmap_filename = f"heatmap_{screening_session_id}_{eye_side}.jpg"
                    bucket_name = "retinal-scans"

                    supabase.storage.from_(bucket_name).upload(
                        path=f"heatmaps/{heatmap_filename}",
                        file=file_bytes,
                        file_options={"content-type": "image/jpeg", "upsert": "true"}
                    )

                    heatmap_url = supabase.storage.from_(bucket_name).get_public_url(f"heatmaps/{heatmap_filename}")
                    logger.info(f"Heatmap generated: {heatmap_url}")

            except Exception as hm_e:
                logger.error(f"Heatmap generation failed for {eye_side} eye: {hm_e}")

            result_row = {
                "screening_session_id": str(screening_session_id),
                "eye": eye_side.lower(),
                "disease_detected": prediction["dr_presence"],
                "dr_severity": prediction["dr_severity"],
                "referable": prediction["referable"],
                "confidence_score": prediction["confidence_score"],
                "macular_involvement": prediction["macular_involvement"],
                "llm_summary": prediction["llm_summary"],
                "follow_up_interval": prediction["follow_up_interval"],
                "warnings": [str(w) for w in prediction["warnings"]],
                "class_probabilities": prediction["class_probabilities"],
                "heatmap_url": heatmap_url
            }

            results.append(result_row)
            logger.info(f"✅ {eye_side.capitalize()} eye: {prediction['predicted_class']} (confidence: {prediction['confidence_score']:.2%})")

        except Exception as e:
            logger.error(f"Failed to process {eye_side} eye: {e}")
            results.append({
                "screening_session_id": str(screening_session_id),
                "eye": eye_side,
                "disease_detected": False,
                "dr_severity": "error",
                "referable": False,
                "confidence_score": 0.0,
                "macular_involvement": "no",
                "llm_summary": f"Analysis failed: {str(e)}",
                "follow_up_interval": "manual_review",
                "warnings": [f"Processing error: {str(e)}"],
                "heatmap_url": None
            })

    if not results:
        logger.error("No valid results generated. Check if image URLs exist.")
        raise HTTPException(
            status_code=400,
            detail="Analysis failed: No valid images found to process. Please check image uploads."
        )

    try:
        ins = (
            supabase.table("ai_results")
            .upsert(results, on_conflict="screening_session_id,eye")
            .execute()
        )
        logger.info(f"✅ Saved {len(results)} AI results to database")
    except Exception as e:
        logger.error(f"Failed to upsert ai_results: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save AI results: {e}"
        )

    try:
        supabase.table("screening_sessions").update(
            {"status": "analysed"}
        ).eq(
            "id", str(screening_session_id)
        ).execute()
        logger.info(f"✅ Updated session status to 'analysed'")
    except Exception as e:
        logger.error(f"Failed to update session status: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update session status: {e}"
        )

    return {
        "ok": True,
        "message": f"Successfully analyzed {len(results)} images",
        "data": ins.data or []
    }


@router.get("/results/by-session/{screening_session_id}")
def get_results_by_session(screening_session_id: UUID):
    try:
        res = (
            supabase.table("ai_results")
            .select("*")
            .eq("screening_session_id", str(screening_session_id))
            .order("created_at", desc=True)
            .execute()
        )
        return {"ok": True, "data": res.data or []}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch ai_results: {e}"
        )


class AIResultOverride(PydanticBaseModel):
    disease_detected: bool
    disease_type: str
    severity_label: str


@router.patch("/result/{ai_result_id}")
def override_ai_result(ai_result_id: str, body: AIResultOverride):
    existing = (
        supabase.table("ai_results")
        .select("id, screening_session_id")
        .eq("id", ai_result_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="AI result not found")

    session_id = existing.data[0].get("screening_session_id")

    update_data = {
        "disease_detected": body.disease_detected,
        "disease_type": body.disease_type,
        "severity_label": body.severity_label,
        "dr_severity": None,
        "referable": None,
        "confidence_score": None,
        "follow_up_interval": None,
        "llm_summary": None,
        "warnings": [],
    }

    supabase.table("ai_results").update(update_data).eq("id", ai_result_id).execute()

    try:
        supabase.table("ai_results").update(
            {"rag_summary": None, "ragas_scores": None}
        ).eq("screening_session_id", session_id).execute()
        logger.info("Invalidated rag_summary for session %s after doctor edit", session_id)
    except Exception as inv_err:
        logger.warning("Failed to invalidate rag_summary for session %s: %s", session_id, inv_err)

    return {
        "ok": True,
        "message": "AI result updated. Clinical summary invalidated — please regenerate.",
        "rag_invalidated": True,
    }


@router.get("/health")
def health_check():
    return {
        "ok": True,
        "model_loaded": model is not None,
        "device": str(device),
        "num_classes": NUM_CLASSES,
        "classes": CLASSES
    }


@router.post("/reanalyze/{screening_session_id}")
def reanalyze(screening_session_id: UUID):
    s = (
        supabase.table("screening_sessions")
        .select("*")
        .eq("id", str(screening_session_id))
        .execute()
    )
    if not s.data:
        raise HTTPException(status_code=404, detail="Screening session not found")

    return analyze(screening_session_id)


# ======================================================
# RAG: INGESTION
# ======================================================
@router.get("/rag-summary/{session_id}")
def get_rag_summary(session_id: UUID):
    try:
        res = (
            supabase.table("ai_results")
            .select("rag_summary")
            .eq("screening_session_id", str(session_id))
            .limit(1)
            .execute()
        )
        if not res.data or not res.data[0].get("rag_summary"):
            return {"rag_summary": None}
        return {"rag_summary": res.data[0]["rag_summary"]}
    except Exception as e:
        logger.error(f"Failed to fetch rag_summary: {e}")
        return {"rag_summary": None}


@router.patch("/rag-summary/{session_id}")
async def update_rag_summary(session_id: str, payload: dict):
    rag_summary = payload.get("rag_summary", "")
    supabase.table("ai_results") \
        .update({"rag_summary": rag_summary}) \
        .eq("screening_session_id", session_id) \
        .execute()
    return {"ok": True, "message": "RAG summary updated"}


FRONT_MATTER_PATTERNS = [
    r"statement of intent",
    r"table of contents",
    r"list of (tables|figures|abbreviations|contributors)",
    r"^\s*references\s*$",
    r"levels? of evidence",
    r"grades? of recommendation",
    r"acknowledge?ments?",
    r"expert panel",
    r"^\s*copyright",
    r"disclaimer",
    r"foreword",
    r"preface",
    r"abbreviations? and acronyms",
]


def is_front_matter(page_text: str) -> bool:
    """
    Detect boilerplate / front-matter pages that should be skipped
    during ingestion. Returns True if the page should be skipped.

    Logic:
      - Pages shorter than 200 chars (title pages, blanks) → skipped
      - Pages matching 2+ boilerplate patterns → skipped
    """
    text = page_text.lower().strip()
    if len(text) < 200:
        return True
    hits = sum(1 for pattern in FRONT_MATTER_PATTERNS if re.search(pattern, text))
    return hits >= 2


@router.post("/ingest-research")
def ingest_research_papers(bucket_name: str = "guidelines"):
    try:
        files = supabase.storage.from_(bucket_name).list()
        if not files:
            return {"message": "No files found in storage bucket"}

        documents = []
        ingestion_stats = []

        for file in files:
            file_name = file['name']
            if not file_name.endswith('.pdf'):
                continue

            logger.info(f"Processing {file_name}...")

            file_data = supabase.storage.from_(bucket_name).download(file_name)

            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(file_data)
                tmp_path = tmp.name

            loader = PyPDFLoader(tmp_path)
            raw_docs = loader.load()

            # --- Change 1: filter out front-matter pages ---
            total_pages = len(raw_docs)
            filtered_docs = []
            skipped_pages = []

            for page_doc in raw_docs:
                page_num = page_doc.metadata.get("page", -1)
                if is_front_matter(page_doc.page_content):
                    skipped_pages.append(page_num)
                else:
                    filtered_docs.append(page_doc)

            logger.info(
                f"  {file_name}: kept {len(filtered_docs)}/{total_pages} pages "
                f"(skipped front-matter pages: {skipped_pages})"
            )

            # --- Change 2: larger, section-aware chunks ---
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=2000,
                chunk_overlap=300,
                separators=["\n## ", "\n### ", "\n#### ", "\n\n", "\n", ". ", " ", ""],
            )
            docs = text_splitter.split_documents(filtered_docs)

            # --- Change 3: tag chunks with source metadata ---
            for doc in docs:
                doc.metadata["source"] = file_name
                # page number from PyPDFLoader is preserved automatically

            documents.extend(docs)
            ingestion_stats.append({
                "file": file_name,
                "total_pages": total_pages,
                "kept_pages": len(filtered_docs),
                "skipped_pages": skipped_pages,
                "chunks_produced": len(docs),
            })

            os.remove(tmp_path)

        if documents:
            # Batch embeddings to stay under OpenAI's 300k tokens-per-request limit.
            # text-embedding-3-small averages ~250-400 tokens per 2000-char chunk,
            # so 100 chunks per batch keeps us comfortably under the cap.
            BATCH_SIZE = 100
            total = len(documents)
            for i in range(0, total, BATCH_SIZE):
                batch = documents[i:i + BATCH_SIZE]
                logger.info(
                    f"Embedding batch {i // BATCH_SIZE + 1}/{(total + BATCH_SIZE - 1) // BATCH_SIZE} "
                    f"({len(batch)} chunks, {i + len(batch)}/{total} total)"
                )
                vector_store.add_documents(batch)

            return {
                "message": f"Successfully ingested {total} chunks from {len(ingestion_stats)} files.",
                "stats": ingestion_stats,
            }

        return {"message": "No documents processed", "stats": ingestion_stats}

    except Exception as e:
        logger.error(f"Ingestion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ======================================================
# RAG: REPORT GENERATION (CrewAI multi-agent)
# ======================================================
def _is_no_dr_session(ai_results_data: list) -> bool:
    """
    Returns True if all eyes in the session were classified as 'No DR' / 'none'
    and no doctor override has set a non-none severity_label.
    """
    if not ai_results_data:
        return False

    severity_levels = {'none': 0, 'mild': 1, 'moderate': 2, 'severe': 3, 'proliferative': 4}

    for result in ai_results_data:
        # Defensive read — handles doctor-overridden rows where dr_severity is null
        severity = (result.get('dr_severity') or result.get('severity_label') or 'none').lower()

        # Any disease (DR severity, cataract, or glaucoma) → not a No DR session
        if severity in ('cataract', 'glaucoma'):
            return False
        if severity_levels.get(severity, 0) > 0:
            return False

    return True


# ----------------------------------------------------------------------
# DISABLED — original single-pipeline RAG endpoint.
# Superseded by /summarise-rag-crew (CrewAI multi-agent version).
# Kept here for reference and possible future comparison.
# ----------------------------------------------------------------------
'''
@router.post("/summarise-rag")
def generate_rag_summary(screening_session_id: UUID):
    try:
        # --- STEP 1: FETCH SESSION & DOCTOR CONTEXT ---
        session_res = (
            supabase.table("screening_sessions")
            .select("patient_id, session_date, assigned_doctor_id")
            .eq("id", str(screening_session_id))
            .single()
            .execute()
        )
        if not session_res.data:
            raise HTTPException(status_code=404, detail="Session not found")

        patient_id = session_res.data['patient_id']
        doctor_id = session_res.data.get('assigned_doctor_id')
        current_date_raw = session_res.data.get('session_date')
        current_date = current_date_raw[:10] if current_date_raw else "Unknown Date"

        doctor_name = "Doctor"
        if doctor_id:
            try:
                doc_res = (
                    supabase.table("staff_users")
                    .select("name")
                    .eq("id", doctor_id)
                    .single()
                    .execute()
                )
                if doc_res.data:
                    doctor_name = doc_res.data.get('name', 'Doctor')
            except Exception as e:
                logger.warning(f"Could not fetch doctor name: {e}")

        # --- STEP 2: FETCH PATIENT DETAILS ---
        # NOTE: reads glaucoma_family_history and elevated_iop_history
        # (correct column names from the patients table)
        patient_res = (
            supabase.table("patients")
            .select("name, age, diabetes_known, diabetes_type, diabetes_duration_years, comorbidities, notes, glaucoma_family_history, elevated_iop_history, previous_eye_surgery, visual_symptoms")
            .eq("id", patient_id)
            .single()
            .execute()
        )
        pt = patient_res.data if patient_res.data else {}

        comorbidities = pt.get('comorbidities')
        if isinstance(comorbidities, list):
            comorbidities_str = ", ".join(comorbidities)
        else:
            comorbidities_str = str(comorbidities) if comorbidities else "None"

        patient_history_str = f"""
        - Name: {pt.get('name', 'Unknown')}
        - Age: {pt.get('age', 'N/A')}
        - Known Diabetic: {pt.get('diabetes_known', 'N/A')}
        - Type: {pt.get('diabetes_type', 'N/A')} ({pt.get('diabetes_duration_years', 0)} years)
        - Comorbidities: {comorbidities_str}
        - Family History of Glaucoma: {pt.get('glaucoma_family_history', 'Unknown')}
        - Previously Elevated IOP: {pt.get('elevated_iop_history', 'Unknown')}
        - Previous Eye Surgery or Trauma: {pt.get('previous_eye_surgery', 'Unknown')}
        - Visual Symptoms: {pt.get('visual_symptoms', 'None')}
        - Clinical Notes: {pt.get('notes', 'None')}
        """

        # --- STEP 3: FETCH PREVIOUS SESSIONS ---
        past_sessions = (
            supabase.table("screening_sessions")
            .select("id, session_date")
            .eq("patient_id", patient_id)
            .neq("id", str(screening_session_id))
            .order("session_date", desc=True)
            .limit(3)
            .execute()
        )

        past_history_str = "No previous screening records found."
        if past_sessions.data:
            past_lines = []
            for s in past_sessions.data:
                old_res = supabase.table("ai_results").select("eye, dr_severity, severity_label").eq("screening_session_id", s['id']).execute()
                s_date = s['session_date'][:10] if s['session_date'] else "Unknown"
                if old_res.data:
                    res_summary = ", ".join([
                        f"{(r.get('eye') or '').capitalize()}: {(r.get('dr_severity') or r.get('severity_label') or 'none').capitalize()}"
                        for r in old_res.data
                    ])
                    past_lines.append(f"- {s_date}: {res_summary}")
                else:
                    past_lines.append(f"- {s_date}: No AI results recorded")
            if past_lines:
                past_history_str = "\n".join(past_lines)

        # --- STEP 4: FETCH CURRENT AI RESULTS ---
        ai_res = (
            supabase.table("ai_results")
            .select("*")
            .eq("screening_session_id", str(screening_session_id))
            .execute()
        )

        if not ai_res.data:
            raise HTTPException(status_code=404, detail="No AI analysis found. Run /analyze first.")

        # --- NO DR BYPASS ---
        # Healthy screenings skip the RAG pipeline and return a fixed template.
        if _is_no_dr_session(ai_res.data):
            logger.info(f"No DR bypass triggered for session {screening_session_id}")
            try:
                supabase.table("ai_results").update(
                    {"rag_summary": NORMAL_SCREENING_TEMPLATE}
                ).eq("screening_session_id", str(screening_session_id)).execute()
            except Exception as save_err:
                logger.warning(f"Failed to persist No DR template: {save_err}")
            return {
                "rag_summary": NORMAL_SCREENING_TEMPLATE,
                "references": []
            }

        severity_levels = {'none': 0, 'mild': 1, 'moderate': 2, 'severe': 3, 'proliferative': 4}
        worst_severity_score = -1
        worst_condition_name = "No DR"

        diagnostic_lines = []
        for result in ai_res.data:
            eye = (result.get('eye') or '').capitalize()
            is_edited = result.get('dr_severity') is None and result.get('severity_label') is not None
            severity = result.get('dr_severity') or result.get('severity_label') or 'none'
            confidence = result.get('confidence_score') or 0.0

            current_score = severity_levels.get(severity.lower(), 0)
            if current_score > worst_severity_score:
                worst_severity_score = current_score
                worst_condition_name = severity

            if is_edited:
                disease_type = result.get('disease_type') or 'Unknown'
                diagnostic_lines.append(
                    f"- **{eye} Eye**: {disease_type} — {severity.capitalize()} *(doctor-confirmed)*"
                )
            else:
                severity_lower = severity.lower()
                label = severity.capitalize() if severity_lower in ['cataract', 'glaucoma'] else f"{severity.capitalize()} DR"
                diagnostic_lines.append(
                    f"- **{eye} Eye**: Prediction: {label} | Confidence: {confidence:.1%}"
                )

        diagnostic_data_str = "\n".join(diagnostic_lines)

        # --- STEP 5: RAG RETRIEVAL ---
        if worst_condition_name.lower() in ['cataract', 'glaucoma']:
            search_query = f"management and referral guidelines for {worst_condition_name} Malaysia"
        else:
            search_query = f"management and referral guidelines for {worst_condition_name} diabetic retinopathy Malaysia"

        query_vector = embeddings.embed_query(search_query)

        rpc_response = supabase.rpc(
            "match_documents",
            {
                "query_embedding": query_vector,
                "match_threshold": 0.45,
                "match_count": 5
            }
        ).execute()

        retrieved_docs = rpc_response.data or []
        if retrieved_docs:
            context_text = "\n\n".join([f"[Source: {d.get('metadata', {}).get('source', 'Guidelines')}] {d.get('content', '')}" for d in retrieved_docs])
        else:
            context_text = "No specific local guidelines found in database."

        # --- STEP 6a: LLM CALL 1 — Guideline Extractor (gpt-4o-mini) ---
        logger.info("LLM Call 1: Extracting structured guidelines with gpt-4o-mini")
        extraction_response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a clinical guideline extraction assistant. Extract and condense the key actionable points from the provided guideline text into structured bullet points."
                },
                {
                    "role": "user",
                    "content": f"""From the following clinical guideline text for **{worst_condition_name}**, extract and condense into structured bullet points covering:
- Recommended referral timeline
- Key management steps
- Urgent action triggers
- Follow-up intervals

Guideline text:
{context_text}"""
                }
            ],
            temperature=0.1,
            max_tokens=1000,
        )
        extracted_guidelines = extraction_response.choices[0].message.content

        # --- STEP 6b: LLM CALL 2 — Report Writer (gpt-4o) ---
        logger.info("LLM Call 2: Generating full clinical report with gpt-4o")
        system_msg = "You are Visionary AI, a medical assistant. Use the provided context to generate a structured clinical summary. Use Markdown formatting."

        user_msg = f"""
        **Target Audience:**
        You are writing this report for **{doctor_name}**.

        **Patient Medical History:**
        {patient_history_str}

        **Previous Screening History:**
        {past_history_str}

        **Current Diagnostic Data (from CNN - {current_date}):**
        {diagnostic_data_str}

        **Clinical Guidelines (Retrieved via RAG):**
        {extracted_guidelines}

        **Important — Doctor-Confirmed Diagnoses:**
        For eyes marked *(doctor-confirmed)* in the diagnostic data above, do NOT mention any
        confidence percentage — that diagnosis was set by the doctor, not the AI. Refer to it
        as the doctor's confirmed diagnosis rather than an AI prediction.

        **Task:**
        Generate a report with exactly these headings:
        1. **Title**: Write exactly "### Clinical Summary for {doctor_name}"
        2. **Diagnostic Summary**: State the finding for each eye clearly. For AI-predicted eyes, state the AI finding with its confidence; for doctor-confirmed eyes, state the doctor's diagnosis without any confidence figure. Compare with previous screening history and note if condition is new, stable, or worsened.
        3. **Patient Risk Profile**: Summarize diabetes history, comorbidities, family history of glaucoma, IOP history, previous eye surgery, and visual symptoms. Highlight any risk factors relevant to {worst_condition_name}.
        4. **Key Clinical Features**: Describe typical retinal signs for {worst_condition_name}.
        5. **Recommended Management**: Based on the retrieved guidelines, provide a specific referral timeline, management steps, and follow-up schedule tailored to this patient's risk profile.
        6. **Disclaimer**: Remind the user this is AI-assisted.
        """

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg}
            ],
            temperature=0.3
        )

        final_report = response.choices[0].message.content
        sources = list(set([d.get('metadata', {}).get('source', 'Unknown') for d in retrieved_docs]))

        try:
            supabase.table("ai_results").update(
                {"rag_summary": final_report}
            ).eq("screening_session_id", str(screening_session_id)).execute()
        except Exception as save_err:
            print(f"[ai.py] Failed to persist rag_summary: {save_err}")

        return {
            "rag_summary": final_report,
            "references": sources
        }

    except Exception as e:
        logger.error(f"RAG Report Generation failed: {e}")
        return {
            "rag_summary": f"**Error generating report:** {str(e)}\n\nPlease review raw results manually.",
            "references": []
        }
'''


@router.post("/summarise-rag-crew")
def generate_rag_summary_crew(screening_session_id: UUID):
    """
    Multi-agent version of /summarise-rag using CrewAI.
    Same input/output contract as /summarise-rag.
    """
    import re

    try:
        # --- NO DR BYPASS ---
        # Healthy screenings skip the RAG pipeline (and CrewAI) entirely
        # and return a fixed normal-screening template.
        ai_res = (
            supabase.table("ai_results")
            .select("*")
            .eq("screening_session_id", str(screening_session_id))
            .execute()
        )
        if ai_res.data and _is_no_dr_session(ai_res.data):
            logger.info(f"No DR bypass triggered for session {screening_session_id} (crew endpoint)")
            try:
                supabase.table("ai_results").update(
                    {"rag_summary": NORMAL_SCREENING_TEMPLATE}
                ).eq("screening_session_id", str(screening_session_id)).execute()
            except Exception as save_err:
                logger.warning(f"Failed to persist No DR template: {save_err}")
            return {
                "rag_summary": NORMAL_SCREENING_TEMPLATE,
                "references": []
            }

        from backend.agents.crew import run_clinical_report_crew
        import json

        result = run_clinical_report_crew(str(screening_session_id))

        raw = result.raw if hasattr(result, "raw") else str(result)

        # The agent sometimes wraps its JSON output in ```json ... ``` fences,
        # which makes json.loads fail. Strip the fences before parsing.
        cleaned = raw.strip()
        cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)

        try:
            parsed = json.loads(cleaned)
            return {
                "rag_summary": parsed.get("rag_summary", cleaned),
                "references": parsed.get("references", []),
            }
        except json.JSONDecodeError:
            return {"rag_summary": cleaned, "references": []}

    except Exception as e:
        logger.error(f"Crew RAG generation failed: {e}")
        return {
            "rag_summary": f"**Error generating report:** {str(e)}\n\nPlease review raw results manually.",
            "references": [],
        }


# ======================================================
# RAG: EVALUATION ENDPOINT (RAGAS)
# ======================================================
@router.post("/evaluate-rag/{screening_session_id}")
def evaluate_rag(screening_session_id: UUID):
    """
    Evaluates the existing RAG summary for a session using RAGAS metrics:
    faithfulness, answer_relevancy, and context_precision.
    RAGAS is imported lazily here — it is never called from the frontend.
    """
    # --- Lazy RAGAS import (runs once, on first call) ---
    global _ragas_loaded, _ragas_evaluate, _ragas_metrics, _ragas_llm, _ragas_embeddings
    if not _ragas_loaded:
        from ragas import evaluate as _ragas_evaluate
        from ragas.llms import LangchainLLMWrapper
        from ragas.embeddings import LangchainEmbeddingsWrapper
        from langchain_openai import ChatOpenAI as LCChatOpenAI
        from ragas.metrics import faithfulness, answer_relevancy, context_precision
        from datasets import Dataset as _Dataset
        _ragas_metrics = [faithfulness, answer_relevancy, context_precision]
        _ragas_llm = LangchainLLMWrapper(LCChatOpenAI(model="gpt-4o-mini", max_tokens=4000))
        _ragas_embeddings = LangchainEmbeddingsWrapper(embeddings)
        _ragas_loaded = True
        # Store Dataset in module scope so it's accessible below
        globals()['_Dataset'] = _Dataset

    from datasets import Dataset

    try:
        # --- STEP 1: Fetch existing RAG summary ---
        ai_res = (
            supabase.table("ai_results")
            .select("*")
            .eq("screening_session_id", str(screening_session_id))
            .execute()
        )

        if not ai_res.data:
            raise HTTPException(status_code=404, detail="No AI results found for this session.")

        rag_summary = ai_res.data[0].get("rag_summary")
        if not rag_summary:
            raise HTTPException(status_code=404, detail="No RAG summary found. Generate one first via /summarise-rag.")

        # --- STEP 2: Rebuild worst_condition_name defensively ---
        severity_levels = {'none': 0, 'mild': 1, 'moderate': 2, 'severe': 3, 'proliferative': 4}
        worst_severity_score = -1
        worst_condition_name = "No DR"

        for result in ai_res.data:
            severity = result.get('dr_severity') or result.get('severity_label') or 'none'
            current_score = severity_levels.get(severity.lower(), 0)
            if current_score > worst_severity_score:
                worst_severity_score = current_score
                worst_condition_name = severity

        # --- STEP 3: Rebuild search_query ---
        if worst_condition_name.lower() in ['cataract', 'glaucoma']:
            search_query = f"management and referral guidelines for {worst_condition_name} Malaysia"
        else:
            search_query = f"management and referral guidelines for {worst_condition_name} diabetic retinopathy Malaysia"

        # --- STEP 4: Re-run RAG retrieval ---
        query_vector = embeddings.embed_query(search_query)

        rpc_response = supabase.rpc(
            "match_documents",
            {
                "query_embedding": query_vector,
                "match_threshold": 0.45,
                "match_count": 5
            }
        ).execute()

        retrieved_docs = rpc_response.data or []
        contexts = [d.get("content", "") for d in retrieved_docs]

        if not contexts:
            raise HTTPException(status_code=404, detail="No retrieved documents found for evaluation.")

        # --- STEP 5: Build RAGAS Dataset and evaluate ---
        ragas_dataset = Dataset.from_dict({
            "question": [search_query],
            "answer": [rag_summary],
            "contexts": [contexts],
        })

        ragas_result = _ragas_evaluate(
            dataset=ragas_dataset,
            metrics=_ragas_metrics,
            llm=_ragas_llm,
            embeddings=_ragas_embeddings,
        )

        df = ragas_result.to_pandas()
        scores = {}
        for col in df.columns:
            if col in ("question", "answer", "contexts", "reference", "ground_truth", "user_input", "response", "retrieved_contexts"):
                continue
            try:
                val = float(df[col].mean())
                if math.isnan(val) or math.isinf(val):
                    scores[col] = None
                else:
                    scores[col] = val
            except (ValueError, TypeError):
                continue

        # --- STEP 6: Persist scores ---
        try:
            supabase.table("ai_results").update(
                {"ragas_scores": scores}
            ).eq("screening_session_id", str(screening_session_id)).execute()
            logger.info(f"RAGAS scores persisted for session {screening_session_id}")
        except Exception as persist_err:
            logger.warning(f"Failed to persist ragas_scores: {persist_err}")

        return {
            "ok": True,
            "session_id": str(screening_session_id),
            "condition": worst_condition_name,
            "scores": scores,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"RAGAS evaluation failed: {e}")
        raise HTTPException(status_code=500, detail=f"RAGAS evaluation failed: {str(e)}")


# ======================================================
# RAG: TRACE / DEBUG ENDPOINT
# ======================================================
@router.get("/rag-trace/{screening_session_id}")
def rag_trace(screening_session_id: UUID):
    """
    Read-only debug endpoint that re-runs only the RAG retrieval step
    (no LLM calls, no DB writes) and returns trace data for FYP evaluation.
    """
    try:
        ai_res = (
            supabase.table("ai_results")
            .select("*")
            .eq("screening_session_id", str(screening_session_id))
            .execute()
        )

        if not ai_res.data:
            raise HTTPException(status_code=404, detail="No AI results found for this session.")

        severity_levels = {'none': 0, 'mild': 1, 'moderate': 2, 'severe': 3, 'proliferative': 4}
        worst_severity_score = -1
        worst_condition_name = "No DR"

        for result in ai_res.data:
            # Defensive read — handles doctor-overridden rows where dr_severity is null
            severity = result.get('dr_severity') or result.get('severity_label') or 'none'
            current_score = severity_levels.get(severity.lower(), 0)
            if current_score > worst_severity_score:
                worst_severity_score = current_score
                worst_condition_name = severity

        if worst_condition_name.lower() in ['cataract', 'glaucoma']:
            search_query = f"management and referral guidelines for {worst_condition_name} Malaysia"
        else:
            search_query = f"management and referral guidelines for {worst_condition_name} diabetic retinopathy Malaysia"

        query_vector = embeddings.embed_query(search_query)

        rpc_response = supabase.rpc(
            "match_documents",
            {
                "query_embedding": query_vector,
                "match_threshold": 0.45,
                "match_count": 5
            }
        ).execute()

        retrieved_docs = rpc_response.data or []

        retrieved_chunks = []
        for doc in retrieved_docs:
            content = doc.get("content", "")
            preview = content[:300] + "..." if len(content) > 300 else content
            retrieved_chunks.append({
                "source": doc.get("metadata", {}).get("source", "Unknown"),
                "similarity": doc.get("similarity", None),
                "content_preview": preview
            })

        final_report = ai_res.data[0].get("rag_summary")

        return {
            "session_id": str(screening_session_id),
            "condition": worst_condition_name,
            "search_query": search_query,
            "num_retrieved": len(retrieved_chunks),
            "retrieved_chunks": retrieved_chunks,
            "final_report": final_report
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"RAG trace failed: {e}")
        raise HTTPException(status_code=500, detail=f"RAG trace failed: {str(e)}")