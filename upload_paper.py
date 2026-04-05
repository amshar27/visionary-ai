import os
from supabase import create_client
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import SupabaseVectorStore

# 1. Setup Supabase Client
SUPABASE_URL = "your_supabase_url"
SUPABASE_KEY = "your_service_role_key" # Use SERVICE_ROLE key for writing to DB
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# 2. Setup Embeddings (Must match the dimensions in your SQL table!)
# Since you use Claude for generation, you still need an embedding model.
# OpenAI is standard, but you can use HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2") for free.
embeddings = OpenAIEmbeddings(openai_api_key="your_openai_key") 

def ingest_paper(file_path):
    file_name = os.path.basename(file_path)
    
    # --- Step A: Upload PDF to Supabase Storage ---
    print(f"Uploading {file_name} to Storage...")
    with open(file_path, "rb") as f:
        supabase.storage.from_("research_papers").upload(
            file=f,
            path=file_name,
            file_options={"content-type": "application/pdf", "upsert": "true"}
        )
    
    # --- Step B: Process Text for Vector DB ---
    print("Processing text...")
    loader = PyPDFLoader(file_path)
    docs = loader.load()
    
    # Split text into chunks (AI can't read whole book at once)
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = text_splitter.split_documents(docs)
    
    # Add metadata (Link the chunk to the file in storage)
    for chunk in chunks:
        chunk.metadata["source"] = file_name
        chunk.metadata["url"] = f"{SUPABASE_URL}/storage/v1/object/public/research_papers/{file_name}"

    # --- Step C: Store Embeddings in Supabase Vector ---
    print(f"Storing {len(chunks)} vector chunks...")
    vector_store = SupabaseVectorStore.from_documents(
        documents=chunks,
        embedding=embeddings,
        client=supabase,
        table_name="documents",
        query_name="match_documents"
    )
    print("Done! Paper is now searchable.")

# Run it
ingest_paper("malaysia_eye_health_report.pdf")