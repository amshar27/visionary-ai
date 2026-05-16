import axios from 'axios';
import type {
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  APIResponse,
  Patient,
  PatientCreate,
  ScreeningSession,
  ScreeningCreate,
  RetinalImage,
  AIResult,
  AIAnalyzeResponse,
  RAGSummaryResponse,
  AIHealthResponse,
  DoctorReviewRequest,
  DoctorReview,
  StaffUser,
  UpdateStaffNameRequest,
  ResetStaffPasswordRequest,
  DeleteStaffRequest,
  UpdatePatientByICRequest,
  DeletePatientByICRequest,
  Appointment,
  AppointmentCreate,
  AppointmentStatusUpdate,
} from '../types';

// ─── Axios Instance ───────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * This backend does NOT use JWT bearer tokens.
 * The user identity (user_id, role, etc.) is stored in localStorage
 * and passed as needed in request bodies (e.g. created_by, doctor_id).
 * This interceptor is kept as a no-op placeholder in case auth is added later.
 */
api.interceptors.request.use((config) => {
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.detail ||
      error.response?.data?.message ||
      error.message ||
      'An unexpected error occurred.';
    return Promise.reject(new Error(message));
  }
);

export default api;

// ─── Auth API ─────────────────────────────────────────────────────────────────

export const authAPI = {
  login: (data: LoginRequest) =>
    api.post<AuthResponse>('/auth/login', data).then((r) => r.data),

  register: (data: RegisterRequest) =>
    api.post<AuthResponse>('/auth/register', data).then((r) => r.data),

  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }).then((r) => r.data),

  verifyOtp: (email: string, otp_code: string) =>
    api.post('/auth/verify-otp', { email, otp_code }).then((r) => r.data),

  resetPassword: (email: string, new_password: string) =>
    api.post('/auth/reset-password', { email, new_password }).then((r) => r.data),
};

// ─── Patients API ─────────────────────────────────────────────────────────────

export const patientsAPI = {
  search: (q?: string, limit = 50) =>
    api
      .get<APIResponse<Patient[]>>('/patients', { params: { q, limit } })
      .then((r) => r.data),

  getById: (patient_id: string) =>
    api
      .get<APIResponse<Patient>>(`/patients/${patient_id}`)
      .then((r) => r.data),

  create: (data: PatientCreate) =>
    api.post<APIResponse<Patient>>('/patients', data).then((r) => r.data),
};

// ─── Screenings API ───────────────────────────────────────────────────────────

export const screeningsAPI = {
  getByPatient: (patient_id: string) =>
    api
      .get<APIResponse<ScreeningSession[]>>(`/screenings/by-patient/${patient_id}`)
      .then((r) => r.data),

  getById: (screening_id: string) =>
    api
      .get<APIResponse<ScreeningSession>>(`/screenings/${screening_id}`)
      .then((r) => r.data),

  create: (data: ScreeningCreate) =>
    api
      .post<APIResponse<ScreeningSession>>('/screenings/create', data)
      .then((r) => r.data),

  assignDoctor: (screening_session_id: string, doctor_id: string) =>
    api
      .post<APIResponse>('/screenings/assign-doctor', {
        screening_session_id,
        doctor_id,
      })
      .then((r) => r.data),

  getAssignedToDoctor: (doctor_id: string) =>
    api
      .get<APIResponse<ScreeningSession[]>>(`/screenings/assigned-to/${doctor_id}`)
      .then((r) => r.data),

  getLatestReview: (screening_id: string) =>
    api
      .get<APIResponse<DoctorReview | null>>(
        `/screenings/${screening_id}/doctor-review/latest`
      )
      .then((r) => r.data),

  submitReview: (screening_id: string, data: DoctorReviewRequest) =>
    api
      .post<APIResponse>(`/screenings/${screening_id}/doctor-review`, data)
      .then((r) => r.data),

  delete: (session_id: string) =>
    api
      .delete<APIResponse>(`/screenings/${session_id}`)
      .then((r) => r.data),

  sendReport: (
    sessionId: string,
    payload: { patient_email: string; report_html: string; patient_name: string }
  ) =>
    api
      .post<{ success: boolean }>(`/screenings/${sessionId}/send-report`, payload)
      .then((r) => r.data),
};

// ─── Uploads API ──────────────────────────────────────────────────────────────

export const uploadsAPI = {
  uploadRetinalImage: (
    screening_session_id: string,
    eye_side: 'left' | 'right',
    file: File,
    onProgress?: (percent: number) => void
  ) => {
    const form = new FormData();
    form.append('screening_session_id', screening_session_id);
    form.append('eye_side', eye_side);
    form.append('file', file);
    return api
      .post<APIResponse<RetinalImage>>('/uploads/retinal', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        },
      })
      .then((r) => r.data);
  },

  getBySession: (screening_session_id: string) =>
    api
      .get<APIResponse<RetinalImage[]>>(
        `/uploads/retinal/by-session/${screening_session_id}`
      )
      .then((r) => r.data),
};

// ─── AI API ───────────────────────────────────────────────────────────────────

export const aiAPI = {
  analyze: (screening_session_id: string) =>
    api
      .post<AIAnalyzeResponse>('/ai/analyze', null, {
        params: { screening_session_id },
      })
      .then((r) => r.data),

  reanalyze: (screening_session_id: string) =>
    api
      .post<AIAnalyzeResponse>(`/ai/reanalyze/${screening_session_id}`)
      .then((r) => r.data),

  getResultsBySession: (screening_session_id: string) =>
    api
      .get<APIResponse<AIResult[]>>(
        `/ai/results/by-session/${screening_session_id}`
      )
      .then((r) => r.data),

  summariseRAG: (screening_session_id: string) =>
    api
      .post<RAGSummaryResponse>('/ai/summarise-rag', null, {
        params: { screening_session_id },
      })
      .then((r) => r.data),

  summariseRAGCrew: async (sessionId: string) => {
    const res = await api.post(`/ai/summarise-rag-crew?screening_session_id=${sessionId}`);
    return res.data as RAGSummaryResponse;
  },

  getRagSummary: (sessionId: string) =>
    api.get<{ rag_summary: string | null }>(`/ai/rag-summary/${sessionId}`).then((r) => r.data),

  updateRagSummary: (sessionId: string, ragSummary: string) =>
    api.patch(`/ai/rag-summary/${sessionId}`, { rag_summary: ragSummary }),

  overrideAiResult: async (
    aiResultId: string,
    data: {
      disease_detected: boolean;
      disease_type: string;
      severity_label: string;
    }
  ) => {
    const res = await api.patch(`/ai/result/${aiResultId}`, data);
    return res.data;
  },

  health: () =>
    api.get<AIHealthResponse>('/ai/health').then((r) => r.data),
};

// ─── Staff API ────────────────────────────────────────────────────────────────

export const staffAPI = {
  getDoctors: () =>
    api
      .get<APIResponse<StaffUser[]>>('/staff/doctors')
      .then((r) => r.data),
};

// ─── Admin API ────────────────────────────────────────────────────────────────

export const adminAPI = {
  // Staff users
  getStaffUsers: (role?: string) =>
    api
      .get<APIResponse<StaffUser[]>>('/admin/staff-users', { params: { role } })
      .then((r) => r.data),

  updateStaffName: (staff_id: string, data: UpdateStaffNameRequest) =>
    api
      .patch<APIResponse>(`/admin/staff-users/${staff_id}`, data)
      .then((r) => r.data),

  resetStaffPassword: (staff_id: string, data: ResetStaffPasswordRequest) =>
    api
      .patch<APIResponse>(`/admin/staff-users/${staff_id}/password`, data)
      .then((r) => r.data),

  deleteStaffUser: (staff_id: string, data: DeleteStaffRequest) =>
    api
      .delete<APIResponse>(`/admin/staff-users/${staff_id}`, { data })
      .then((r) => r.data),

  // Patients (admin view)
  getPatients: (role?: string) =>
    api
      .get<APIResponse<Patient[]>>('/admin/patients', { params: { role } })
      .then((r) => r.data),

  updatePatientByIC: (ic_passport: string, data: UpdatePatientByICRequest) =>
    api
      .patch<APIResponse>(`/admin/patients/by-ic/${ic_passport}`, data)
      .then((r) => r.data),

  deletePatientByIC: (ic_passport: string, data: DeletePatientByICRequest) =>
    api
      .delete<APIResponse>(`/admin/patients/by-ic/${ic_passport}`, { data })
      .then((r) => r.data),
};

// ─── Appointments API ─────────────────────────────────────────────────────────

export const appointmentsAPI = {
  getAll: (params?: { patient_id?: string; assigned_doctor_id?: string }) =>
    api.get<Appointment[]>('/appointments', { params }).then((r) => r.data),

  create: (data: AppointmentCreate) =>
    api.post<Appointment>('/appointments', data).then((r) => r.data),

  update: (id: string, data: AppointmentStatusUpdate) =>
    api.patch<Appointment>(`/appointments/${id}`, data).then((r) => r.data),
};
