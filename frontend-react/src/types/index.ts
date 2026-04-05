// ─── Auth ────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  staff_id: string;
  email: string;
  password: string;
}

export type UserRole = 'nurse' | 'doctor' | 'admin';

/** Stored in AuthContext after login */
export interface User {
  user_id: string;
  email: string;
  role: UserRole;
  staff_id: string | null;
  name: string | null;
}

/** Raw login/register response from backend */
export interface AuthResponse {
  ok: boolean;
  message: string;
  user_id: string;
  email: string;
  role: UserRole;
  staff_id: string | null;
  name: string | null;
}

// ─── Generic API Wrapper ─────────────────────────────────────────────────────

export interface APIResponse<T = unknown> {
  ok: boolean;
  data?: T;
  message?: string;
}

// ─── Patients ─────────────────────────────────────────────────────────────────

export interface PatientCreate {
  name: string;
  ic_passport: string;
  age: number;
  sex: string;
  contact_number: string;
  diabetes_known: boolean;
  diabetes_type?: string;
  diabetes_duration_years?: number;
  notes?: string;
}

export interface Patient {
  id: string;
  name: string;
  ic_passport: string;
  age: number;
  sex: string;
  contact_number: string;
  email?: string | null;
  diabetes_known: boolean;
  diabetes_type?: string | null;
  diabetes_duration_years?: number | null;
  notes?: string | null;
  glaucoma_family_history?: string | null;
  elevated_iop_history?: string | null;
  previous_eye_surgery?: string | null;
  visual_symptoms?: string | null;
  created_at: string;
}

// ─── Screening Sessions ───────────────────────────────────────────────────────

export type SessionStatus = 'pending' | 'assigned' | 'analysed' | 'approved' | 'overridden';

export interface ScreeningCreate {
  patient_id: string;
  created_by?: string;
}

export interface ScreeningSession {
  id: string;
  patient_id: string;
  created_by: string | null;
  status: SessionStatus;
  doctor_id?: string | null;
  created_at: string;
  /** Enriched field (joined from patients table) */
  patient?: Patient;
}

// ─── Retinal Images ───────────────────────────────────────────────────────────

export type EyeSide = 'left' | 'right';

export interface RetinalImage {
  id: string;
  screening_session_id: string;
  eye_side: EyeSide;
  image_path: string;
  image_url: string;
  created_at: string;
}

// ─── AI Results ──────────────────────────────────────────────────────────────

export interface AIResult {
  id: string;
  screening_session_id: string;
  eye_side: EyeSide;
  predicted_class: string;
  dr_severity: string;
  disease_detected: boolean | null | undefined;
  disease_type: string | null;
  severity_label: string | null;
  referable: boolean;
  confidence_score: number;
  class_probabilities: Record<string, number>;
  follow_up_interval: string;
  warnings: string[];
  llm_summary: string;
  macular_involvement: boolean;
  heatmap_url: string;
  created_at: string;
}

export interface AIAnalyzeResponse {
  ok: boolean;
  message: string;
  data: AIResult[];
}

export interface RAGSummaryResponse {
  rag_summary: string;
  references: string[];
}

// ─── Doctor Review ────────────────────────────────────────────────────────────

export interface DoctorReviewRequest {
  doctor_id: string;
  decision: 'approved' | 'overridden';
  final_dr_grade_left?: string;
  final_dr_grade_right?: string;
  override_reason?: string;
  report_url?: string;
}

export interface DoctorReview {
  id: string;
  screening_session_id: string;
  doctor_id: string;
  decision: 'approved' | 'overridden';
  final_grade_left?: string | null;
  final_grade_right?: string | null;
  override_reason?: string | null;
  created_at: string;
}

// ─── Staff ────────────────────────────────────────────────────────────────────

export interface StaffUser {
  id: string;
  staff_id: string;
  email: string;
  role: UserRole;
  name: string | null;
  created_at: string;
}

export interface UpdateStaffNameRequest {
  requester_role: string;
  name: string;
}

export interface ResetStaffPasswordRequest {
  requester_role: string;
  new_password: string;
}

export interface DeleteStaffRequest {
  requester_role: string;
}

// ─── Admin – Patients ─────────────────────────────────────────────────────────

export interface UpdatePatientByICRequest {
  requester_role: string;
  name: string;
  ic_passport: string;
  contact_number: string;
}

export interface DeletePatientByICRequest {
  requester_role: string;
}

// ─── AI Health ────────────────────────────────────────────────────────────────

export interface AIHealthResponse {
  ok: boolean;
  model_loaded: boolean;
  device: string;
  num_classes: number;
  classes: string[];
}

// ─── Appointments ─────────────────────────────────────────────────────────────

export interface Appointment {
  id: string;
  patient_id: string;
  scheduled_by: string;
  appointment_datetime: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  notes?: string | null;
  confirmation_sent_at?: string | null;
  notification_sent_at?: string | null;
  created_at: string;
  patient_name?: string | null;
  patient_email?: string | null;
  assigned_doctor_id?: string | null;
}

export interface AppointmentCreate {
  patient_id: string;
  scheduled_by: string;
  appointment_datetime: string;
  notes?: string | null;
  assigned_doctor_id?: string | null;
}

export interface AppointmentStatusUpdate {
  status?: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  notes?: string | null;
}
