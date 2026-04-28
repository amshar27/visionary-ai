# backend/ai.py
import torch
import torch.nn as nn
import io
import requests
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
# NEW IMPORTS FOR RAG
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import SupabaseVectorStore
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy, context_precision
from datasets import Dataset


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

LOCKED_STATUSES = {"assigned", "approved", "overridden"}

# ======================================================
# MODEL CONFIGURATION
# ======================================================
NUM_CLASSES = 7  # Updated from 5 to 7
ATTENTION_DIM = 512
NUM_HEADS = 8
# Updated classes array to match your training script exactly
CLASSES = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative DR', 'Cataract', 'Glaucoma']

# Renamed slightly for clarity, but keeping the dictionary keys mapped to the classes
DISEASE_SEVERITY_MAP = {
    'No DR': 'none',
    'Mild': 'mild',
    'Moderate': 'moderate',
    'Severe': 'severe',
    'Proliferative DR': 'proliferative',
    'Cataract': 'cataract',  # New mapping
    'Glaucoma': 'glaucoma'   # New mapping
}

# Device configuration
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
logger.info(f"Using device: {device}")

# Image preprocessing
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
        # Update path to your model file location
        model.load_state_dict(torch.load('backend/model/best_model.pth', map_location=device))
        model.eval()
        logger.info("✅ Model loaded successfully")
    except Exception as e:
        logger.error(f"❌ Error loading model: {str(e)}")
        raise

# Load model on startup
try:
    load_model()
except Exception as e:
    logger.warning(f"Model not loaded on startup: {e}")

# ======================================================
# HELPER FUNCTIONS
# ======================================================
def download_image_from_supabase(image_url: str) -> Image.Image:
    """
    Download image from Supabase Storage URL and return PIL Image.
    """
    try:
        response = requests.get(image_url, timeout=30)
        response.raise_for_status()
        image = Image.open(io.BytesIO(response.content)).convert('RGB')
        return image
    except Exception as e:
        logger.error(f"Failed to download image from {image_url}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to download image: {e}")

def predict_image(image: Image.Image) -> Dict:
    """
    Run inference on a single image and return predictions.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    try:
        # Preprocess image
        image_tensor = test_transform(image).unsqueeze(0).to(device)
        
        # Make prediction
        with torch.no_grad():
            outputs = model(image_tensor)
            probabilities = torch.nn.functional.softmax(outputs, dim=1)
            confidence, predicted = torch.max(probabilities, 1)
        
       # Extract results
        predicted_idx = predicted.item()
        predicted_class = CLASSES[predicted_idx]
        confidence_score = float(confidence.item())
        
        # Get all class probabilities
        class_probs = {
            CLASSES[i]: float(probabilities[0][i].item()) 
            for i in range(NUM_CLASSES)
        }
        
        # Determine disease presence and referability
        dr_presence = predicted_idx > 0  # True if NOT 'No DR'
        referable = predicted_idx >= 2   # Moderate DR, Severe, Proliferative, Cataract, and Glaucoma all require referral
        
        # Map to your database severity format (keeping variable name dr_severity so DB doesn't break)
        dr_severity = DISEASE_SEVERITY_MAP[predicted_class]
        
        # Determine follow-up interval based on severity
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
        
        # Generate warnings based on specific diseases
        warnings = []
        if referable:
            warnings.append(f"Referable condition detected ({predicted_class}) - specialist referral recommended")
        
        if predicted_idx == 4:  # Proliferative DR
            warnings.append("Proliferative diabetic retinopathy - immediate referral required")
        elif predicted_idx == 5: # Cataract
            warnings.append("Cataract detected - comprehensive eye exam recommended")
        elif predicted_idx == 6: # Glaucoma
            warnings.append("Glaucoma suspect - urgent visual field and IOP testing recommended")
            
        if confidence_score < 0.7:
            warnings.append("Low confidence prediction - manual review recommended")
        
        # Generate LLM-style summary
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
            "macular_involvement": "no"  # This requires separate detection
        }
        
    except Exception as e:
        logger.error(f"Prediction error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

def generate_summary(predicted_class: str, confidence: float, dr_presence: bool, referable: bool) -> str:
    """
    Generate a human-readable summary of the AI analysis using OpenAI LLM.
    """
    try:
        # Prompt the LLM with the specific results
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
        # Fallback if OpenAI fails
        logger.error(f"Summary Error: {e}")
        return f"AI Diagnosis: {predicted_class} ({confidence:.1%}). Please consult a doctor."

def generate_heatmap(image_tensor, original_image_pil, predicted_class_idx):
    """
    Generates a Grad-CAM heatmap overlay.
    """
    try:
        # 1. Select the target layer (Last convolutional layer of ResNet backbone)
        # In your ResNetWithAttention, self.backbone is a Sequential model.
        # We target the last layer of that sequence.
        target_layers = [model.backbone[-1][-1]]

        # 2. Initialize GradCAM
        cam = GradCAM(model=model, target_layers=target_layers)

        # 3. Define the target (the class we want to explain, e.g., 'Severe DR')
        targets = [ClassifierOutputTarget(predicted_class_idx)]

        # 4. Generate the grayscale CAM mask
        grayscale_cam = cam(input_tensor=image_tensor, targets=targets)
        grayscale_cam = grayscale_cam[0, :]  # Take the first item in batch

        # 5. Prepare original image for blending
        # Resize original image to match model input size (224x224) for visualization
        img_resized = original_image_pil.resize((224, 224))
        rgb_img = np.float32(img_resized) / 255
        
        # 6. Create the heatmap overlay (The "Red Blob")
        visualization = show_cam_on_image(rgb_img, grayscale_cam, use_rgb=True)
        
        # 7. Convert back to PIL Image for saving
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
    """
    Analyze retinal images for a screening session using the trained model.
    """
    # 1) Check session exists
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

    # Lock rules
    if status in LOCKED_STATUSES:
        raise HTTPException(
            status_code=403,
            detail=f"Session locked (status={status})."
        )

    # 2) Fetch retinal images with their URLs
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
    
    # Check both eyes are present
    eye_sides = {(r.get("eye_side") or "").lower() for r in imgs.data}
    if not {"left", "right"}.issubset(eye_sides):
        raise HTTPException(
            status_code=400,
            detail="Both left and right images are required before analysis."
        )

    # 3) Process each image with the model
    results = []
    
    for img_record in imgs.data:
        eye_side = (img_record.get("eye_side") or "").lower()
        image_url = img_record.get("image_url")
        
        if not image_url:
            logger.warning(f"No image URL for {eye_side} eye")
            continue
        
        try:
            # --- 1. Download Image ---
            logger.info(f"Processing {eye_side} eye image: {image_url}")
            image = download_image_from_supabase(image_url)
            
            # --- 2. Run Existing Prediction ---
            # Keep this line! It handles all your logic for severity, warnings, and LLM summaries.
            prediction = predict_image(image)
            
            # --- 3. Generate Heatmap (NEW CODE) ---
            heatmap_url = None
            try:
                # We need to recreate the tensor here to pass it to the heatmap generator
                # (This is a small duplication of effort but keeps your code clean)
                image_tensor = test_transform(image).unsqueeze(0).to(device)
                
                # Get the class index required for GradCAM (0=No DR, 1=Mild, etc.)
                # We can map the string class back to an index
                predicted_class_str = prediction["predicted_class"]
                predicted_idx = CLASSES.index(predicted_class_str)

                # Only generate heatmap if it's NOT "No DR" (optional optimization), 
                # or just generate it for everything so users see where AI looked.
                # Here we generate it for everything:
                heatmap_img = generate_heatmap(image_tensor, image, predicted_idx)
                
                if heatmap_img:
                    # Save heatmap to memory buffer
                    buf = io.BytesIO()
                    heatmap_img.save(buf, format='JPEG')
                    buf.seek(0)
                    file_bytes = buf.read()
                    
                    # Upload to Supabase
                    heatmap_filename = f"heatmap_{screening_session_id}_{eye_side}.jpg"
                    bucket_name = "retinal-scans" # Matches your existing bucket
                    
                    supabase.storage.from_(bucket_name).upload(
                        path=f"heatmaps/{heatmap_filename}",
                        file=file_bytes,
                        file_options={"content-type": "image/jpeg", "upsert": "true"}
                    )
                    
                    # Get Public URL
                    heatmap_url = supabase.storage.from_(bucket_name).get_public_url(f"heatmaps/{heatmap_filename}")
                    logger.info(f"Heatmap generated: {heatmap_url}")

            except Exception as hm_e:
                # If heatmap fails, log it but DON'T crash the whole analysis
                logger.error(f"Heatmap generation failed for {eye_side} eye: {hm_e}")
            
            # --- 4. Prepare Result Row (UPDATED) ---
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
                "heatmap_url": heatmap_url  # <--- NEW FIELD ADDED HERE
            }
            
            results.append(result_row)
            logger.info(f"✅ {eye_side.capitalize()} eye: {prediction['predicted_class']} (confidence: {prediction['confidence_score']:.2%})")
            
        except Exception as e:
            logger.error(f"Failed to process {eye_side} eye: {e}")
            # Add error result
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
                "heatmap_url": None # Ensure field exists even on error
            })

   # 4) Upsert results to database
    if not results:
        # FIX: Prevent crash when no images were successfully processed
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

    # 5) Update session status -> analysed
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
    """
    Returns all AI results for a screening session,
    ordered newest-first (per eye).
    """
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
    """
    Allows a doctor to manually override the AI result for a single eye.
    Nulls out confidence, referable, follow_up, llm_summary, and warnings.
    Only updates disease_detected, disease_type, and severity_label.
    """
    existing = supabase.table("ai_results").select("id").eq("id", ai_result_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="AI result not found")

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
    return {"ok": True, "message": "AI result updated"}


@router.get("/health")
def health_check():
    """
    Check if the AI model is loaded and ready.
    """
    return {
        "ok": True,
        "model_loaded": model is not None,
        "device": str(device),
        "num_classes": NUM_CLASSES,
        "classes": CLASSES
    }


@router.post("/reanalyze/{screening_session_id}")
def reanalyze(screening_session_id: UUID):
    """
    Force re-analysis of a screening session (bypasses lock for admin use).
    """
    # Temporarily allow reanalysis by removing lock check
    s = (
        supabase.table("screening_sessions")
        .select("*")
        .eq("id", str(screening_session_id))
        .execute()
    )
    if not s.data:
        raise HTTPException(status_code=404, detail="Screening session not found")
    
    # Call analyze function
    return analyze(screening_session_id)
# ======================================================
# RAG: INGESTION (Run this once or when adding new papers)
# ======================================================
@router.get("/rag-summary/{session_id}")
def get_rag_summary(session_id: UUID):
    """
    Returns the persisted RAG summary for a session, or null if not yet generated.
    """
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


@router.post("/ingest-research")
def ingest_research_papers(bucket_name: str = "guidelines"):
    """
    Downloads PDFs from Supabase Storage, splits them, and indexes them in Vector DB.
    """
    try:
        # 1. List files in the bucket
        files = supabase.storage.from_(bucket_name).list()
        if not files:
            return {"message": "No files found in storage bucket"}

        documents = []
        
        # 2. Process each file
        for file in files:
            file_name = file['name']
            if not file_name.endswith('.pdf'):
                continue
            
            logger.info(f"Processing {file_name}...")
            
            # Download file content
            file_data = supabase.storage.from_(bucket_name).download(file_name)
            
            # Save to temp file because PyPDFLoader expects a file path
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(file_data)
                tmp_path = tmp.name
            
            # Load and split PDF
            loader = PyPDFLoader(tmp_path)
            raw_docs = loader.load()
            
            # Split into chunks (Critical for RAG)
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=1000,
                chunk_overlap=200
            )
            docs = text_splitter.split_documents(raw_docs)
            
            # Add metadata (source file name)
            for doc in docs:
                doc.metadata["source"] = file_name
            
            documents.extend(docs)
            
            # Clean up temp file
            os.remove(tmp_path)

        # 3. Upload vectors to Supabase
        if documents:
            vector_store.add_documents(documents)
            return {"message": f"Successfully ingested {len(documents)} chunks from {len(files)} files."}
        
        return {"message": "No documents processed"}

    except Exception as e:
        logger.error(f"Ingestion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ======================================================
# RAG: GENERATION ENDPOINT
# ======================================================
@router.post("/summarise-rag")
def generate_rag_summary(screening_session_id: UUID):
    """
    Generates a structured medical report including:
    1. Doctor's Name (from 'staff_users')
    2. Patient History & Current Diagnosis
    3. RAG Guidelines
    """
    try:
        # --- STEP 1: FETCH SESSION & DOCTOR CONTEXT ---
        session_res = (
            supabase.table("screening_sessions")
            .select("patient_id, session_date, assigned_doctor_id") # Added assigned_doctor_id
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

        # --- NEW: FETCH DOCTOR'S NAME ---
        doctor_name = "Doctor" # Default fallback
        if doctor_id:
            try:
                # Assuming your staff table has a 'name' or 'full_name' column. 
                # Check your staff_users table schema if this fails.
                doc_res = (
                    supabase.table("staff_users")
                    .select("name") # Change to "full_name" if that is your column name
                    .eq("id", doctor_id)
                    .single()
                    .execute()
                )
                if doc_res.data:
                    doctor_name = doc_res.data.get('name', 'Doctor')
            except Exception as e:
                logger.warning(f"Could not fetch doctor name: {e}")

        # --- STEP 2: FETCH PATIENT DETAILS ---
        patient_res = (
            supabase.table("patients")
            .select("name, age, diabetes_known, diabetes_type, diabetes_duration_years, comorbidities, notes, family_history_glaucoma, elevated_iop, previous_eye_surgery, visual_symptoms")
            .eq("id", patient_id)
            .single()
            .execute()
        )
        pt = patient_res.data if patient_res.data else {}
        
        # Handle comorbidities list vs string
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
        - Family History of Glaucoma: {pt.get('family_history_glaucoma', 'Unknown')}
        - Previously Elevated IOP: {pt.get('elevated_iop', 'Unknown')}
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
                old_res = supabase.table("ai_results").select("eye, dr_severity").eq("screening_session_id", s['id']).execute()
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

        severity_levels = {'none': 0, 'mild': 1, 'moderate': 2, 'severe': 3, 'proliferative': 4}
        worst_severity_score = -1
        worst_condition_name = "No DR"
        
        diagnostic_lines = []
        for result in ai_res.data:
            eye = (result.get('eye') or '').capitalize()
            severity = result.get('dr_severity') or result.get('severity_label') or 'none'
            confidence = result.get('confidence_score') or 0.0

            current_score = severity_levels.get(severity.lower(), 0)
            if current_score > worst_severity_score:
                worst_severity_score = current_score
                worst_condition_name = severity

            severity_lower = severity.lower()
            label = severity.capitalize() if severity_lower in ['cataract', 'glaucoma'] else f"{severity.capitalize()} DR"
            diagnostic_lines.append(
                f"- **{eye} Eye**: Prediction: {label} | Confidence: {confidence:.1%}"
            )
        
        diagnostic_data_str = "\n".join(diagnostic_lines)

        # --- STEP 5: RAG RETRIEVAL ---
        # Format the query based on whether it's DR or one of the new diseases
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

        **Task:**
        Generate a report with exactly these headings:
        1. **Title**: Write exactly "### Clinical Summary for {doctor_name}"
        2. **Diagnostic Summary**: State the AI finding for each eye clearly. Compare with previous screening history and note if condition is new, stable, or worsened.
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

        # Persist RAG summary to ai_results rows for this session
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


# ======================================================
# RAG: EVALUATION ENDPOINT (RAGAS)
# ======================================================
@router.post("/evaluate-rag/{screening_session_id}")
def evaluate_rag(screening_session_id: UUID):
    """
    Evaluates the existing RAG summary for a session using RAGAS metrics:
    faithfulness, answer_relevancy, and context_precision.
    """
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

        # --- STEP 2: Rebuild worst_condition_name from saved dr_severity ---
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

        ragas_result = evaluate(
            dataset=ragas_dataset,
            metrics=[faithfulness, answer_relevancy, context_precision],
        )

        scores = {k: float(v) for k, v in ragas_result.items() if isinstance(v, (int, float))}

        # --- STEP 6: Persist scores to ai_results (best-effort) ---
        try:
            supabase.table("ai_results").update(
                {"ragas_scores": scores}
            ).eq("screening_session_id", str(screening_session_id)).execute()
            logger.info(f"RAGAS scores persisted for session {screening_session_id}")
        except Exception as persist_err:
            logger.warning(f"Failed to persist ragas_scores (column may not exist): {persist_err}")

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