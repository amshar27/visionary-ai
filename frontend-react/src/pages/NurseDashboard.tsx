import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, LogOut, Search, Upload, Brain, UserCheck, Menu, ChevronLeft, ChevronRight, Users, CalendarDays, CalendarPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { patientsAPI, screeningsAPI, uploadsAPI, aiAPI, staffAPI, appointmentsAPI } from '../services/api';
import { formatDt, getEyeSide, fmtConfidence } from '../utils/format';
import type { Patient, ScreeningSession, RetinalImage, AIResult, StaffUser, Appointment } from '../types';

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d1d5db',
  color: '#111827',
};
const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 14,
  padding: '16px 20px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

const elevatedCardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 16,
  padding: '16px 20px',
  boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.08)',
};

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending:    ['#f3f4f6', '#6b7280'],
    assigned:   ['#dbeafe', '#1d4ed8'],
    analysed:   ['#ede9fe', '#7c3aed'],
    approved:   ['#dcfce7', '#16a34a'],
    overridden: ['#ffedd5', '#ea580c'],
  };
  const [bg, color] = map[status?.toLowerCase()] ?? ['#f3f4f6', '#6b7280'];
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: bg, color }}>
      {status ?? '-'}
    </span>
  );
}

// ─── Heatmap toggle ───────────────────────────────────────────────────────────

function HeatmapToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <span className="text-sm font-semibold text-gray-700">Show Heatmap</span>
      <div
        onClick={() => onChange(!value)}
        className="w-10 h-5 rounded-full relative transition-colors"
        style={{ background: value ? '#3b82f6' : '#d1d5db' }}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
          style={{ left: value ? 22 : 2 }}
        />
      </div>
    </label>
  );
}

// ─── Eye panel ────────────────────────────────────────────────────────────────

function EyePanel({
  title,
  result,
  originalImg,
  showHeatmap,
  section = 'full',
}: {
  title: string;
  result: AIResult | null;
  originalImg: RetinalImage | null;
  showHeatmap: boolean;
  section?: 'image' | 'stats' | 'full';
}) {
  const imageUrl = showHeatmap
    ? result?.heatmap_url || originalImg?.image_url
    : originalImg?.image_url;
  const caption = showHeatmap
    ? result?.heatmap_url ? `AI Heatmap (${title})` : `Heatmap unavailable — original (${title})`
    : `Retinal Image (${title})`;

  return (
    <div>
      {section !== 'stats' && (
        <>
          <h4 className="text-sm font-bold text-gray-900 mb-2">{title}</h4>
          {imageUrl ? (
            <img src={imageUrl} alt={caption} className="w-full rounded-lg object-cover" style={{ maxHeight: 260 }} />
          ) : (
            <div className="rounded-lg flex items-center justify-center text-sm" style={{ height: 180, background: '#f3f4f6', color: '#9ca3af' }}>
              No image
            </div>
          )}
          <p className="text-xs text-center mt-1 mb-3 text-gray-500">{caption}</p>
        </>
      )}

      {section !== 'image' && (
        <>
          {result && (
            <div className="space-y-1 text-sm text-gray-600">
              <p><span className="font-semibold text-gray-900">Disease Detected:</span> {result.disease_detected === true ? 'Yes' : result.disease_detected === false ? 'No' : 'Unknown'}</p>
              <p><span className="font-semibold text-gray-900">Disease Type:</span> {result.disease_type ?? 'Not specified'}</p>
              <p><span className="font-semibold text-gray-900">Severity:</span> {result.severity_label ?? result.dr_severity ?? 'Not specified'}</p>
              <p><span className="font-semibold text-gray-900">Referable:</span> {String(result.referable)}</p>
              <p><span className="font-semibold text-gray-900">Confidence:</span> {fmtConfidence(result.confidence_score)}</p>
              <p><span className="font-semibold text-gray-900">Follow-up:</span> {result.follow_up_interval ?? '-'}</p>
              {result.llm_summary && (
                <div className="mt-2 p-2 rounded-lg text-xs" style={{ background: '#f9fafb', border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
                  <p className="font-semibold text-gray-900 mb-1">LLM Summary:</p>
                  <p className="text-gray-600">{result.llm_summary}</p>
                </div>
              )}
              {result.warnings?.length > 0 && (
                <div className="mt-1">
                  <p className="font-semibold text-yellow-600 text-xs">Warnings:</p>
                  {result.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-yellow-700">— {w}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          {!result && (
            <p className="text-sm text-gray-400">No AI result for this eye.</p>
          )}
        </>
      )}
    </div>
  );
}

// ─── View type ────────────────────────────────────────────────────────────────

type NurseView =
  | { name: 'home' }
  | { name: 'new-patient' }
  | { name: 'workspace'; patient: Patient }
  | { name: 'session'; patient: Patient; sessionId: string }
  | { name: 'appointments' };

// ─── Sub-view: New Patient ────────────────────────────────────────────────────

function NewPatientView({
  onBack: _onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (p: Patient) => void;
}) {
  const [name, setName] = useState('');
  const [ic, setIc] = useState('');
  const [age, setAge] = useState<number>(0);
  const [sex, setSex] = useState<'Male' | 'Female'>('Male');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [diabetesStatus, setDiabetesStatus] = useState<'Yes' | 'No' | 'Unknown'>('Unknown');
  const [diabetesType, setDiabetesType] = useState('Type 2');
  const [diabetesDuration, setDiabetesDuration] = useState<number>(0);
  const [glaucomaFamilyHistory, setGlaucomaFamilyHistory] = useState<'Yes' | 'No' | 'Unknown'>('Unknown');
  const [elevatedIopHistory, setElevatedIopHistory] = useState<'Yes' | 'No' | 'Unknown'>('Unknown');
  const [previousEyeSurgery, setPreviousEyeSurgery] = useState<'Yes' | 'No' | 'Unknown'>('Unknown');
  const [visualSymptoms, setVisualSymptoms] = useState<'None' | 'Mild' | 'Severe'>('None');
  const [comorbText, setComorbText] = useState('');
  const [allergiesText, setAllergiesText] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const parseComorbidities = (text: string): string[] => {
    const items: string[] = [];
    for (const line of text.split('\n')) {
      for (const part of line.split(',')) {
        const v = part.trim();
        if (v) items.push(v);
      }
    }
    return items;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !ic.trim()) {
      toast.error('Name and IC / Passport are required.');
      return;
    }
    if (!age || age <= 0) {
      toast.error('Age is required.');
      return;
    }
    if (!contact.trim()) {
      toast.error('Contact number is required.');
      return;
    }
    if (!email.trim()) {
      toast.error('Email is required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        ic_passport: ic.trim(),
        age: age,
        sex: sex === 'Male' ? 'M' : 'F',
        contact_number: contact.trim() || '',
        email: email.trim() || null,
        diabetes_known: diabetesStatus as unknown as boolean, // backend accepts "Yes"/"No"/"Unknown"
        diabetes_type: diabetesStatus === 'Yes' ? diabetesType : undefined,
        diabetes_duration_years: diabetesStatus === 'Yes' ? diabetesDuration : undefined,
        glaucoma_family_history: glaucomaFamilyHistory,
        elevated_iop_history: elevatedIopHistory,
        previous_eye_surgery: previousEyeSurgery,
        visual_symptoms: visualSymptoms,
        notes: notes.trim() || undefined,
        ...(parseComorbidities(comorbText).length > 0 && { comorbidities: parseComorbidities(comorbText) }),
        ...(parseComorbidities(allergiesText).length > 0 && { allergies: parseComorbidities(allergiesText) }),
      };
      const resp = await patientsAPI.create(payload);
      const patient = Array.isArray(resp.data) ? resp.data[0] : resp.data;
      if (!patient) throw new Error('Unexpected response from server.');
      toast.success(`Patient '${patient.name}' created.`);
      onCreated(patient);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create patient.';
      if (msg.toLowerCase().includes('ic_passport') || msg.toLowerCase().includes('already exists')) {
        toast.error('A patient with this IC / Passport already exists.');
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const sectionTitle = (t: string) => (
    <h3 className="text-sm font-bold mb-3 text-gray-600">{t}</h3>
  );

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-1" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>Register New Patient</h2>
      <p className="text-sm mb-5 text-gray-500" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.13)' }}>Fill in the details to create a new patient record.</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Basic Details */}
        <div style={elevatedCardStyle}>
          {sectionTitle('Basic Details')}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs mb-1 block text-gray-500">Full Name *</label>
              <input className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs mb-1 block text-gray-500">IC / Passport Number *</label>
              <input className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} value={ic} onChange={e => setIc(e.target.value)} />
            </div>
            <div>
              <label className="text-xs mb-1 block text-gray-500">Age <span className="text-red-500">*</span></label>
              <input type="number" min={0} max={120} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} value={age === 0 ? '' : age} onChange={e => setAge(isNaN(e.target.valueAsNumber) ? 0 : e.target.valueAsNumber)} />
            </div>
            <div>
              <label className="text-xs mb-1 block text-gray-500">Sex *</label>
              <select className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} value={sex} onChange={e => setSex(e.target.value as 'Male' | 'Female')}>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs mb-1 block text-gray-500">Contact Number <span className="text-red-500">*</span></label>
              <input className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} value={contact} onChange={e => setContact(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="text-xs mb-1 block text-gray-500">Email <span className="text-red-500">*</span></label>
              <input type="email" className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="patient@example.com" />
            </div>
          </div>
        </div>

        {/* Medical & Ocular History */}
        <div style={elevatedCardStyle}>
          {sectionTitle('Medical & Ocular History')}
          <label className="text-xs mb-1 block text-gray-500">Diabetes Known</label>
          <div className="flex gap-4 mb-4">
            {(['Yes', 'No', 'Unknown'] as const).map(opt => (
              <label key={opt} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
                <input type="radio" name="diabetes" value={opt} checked={diabetesStatus === opt} onChange={() => setDiabetesStatus(opt)} />
                {opt}
              </label>
            ))}
          </div>
          {diabetesStatus === 'Yes' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs mb-1 block text-gray-500">Diabetes Type</label>
                <select className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} value={diabetesType} onChange={e => setDiabetesType(e.target.value)}>
                  {['Type 1', 'Type 2', 'Gestational', 'Other', 'Unknown'].map(t => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block text-gray-500">Duration (years)</label>
                <input type="number" min={0} max={80} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} value={diabetesDuration === 0 ? '' : diabetesDuration} onChange={e => setDiabetesDuration(isNaN(e.target.valueAsNumber) ? 0 : e.target.valueAsNumber)} />
              </div>
            </div>
          )}

          <div className="space-y-6 mt-6">
            <div>
              <label className="text-xs mb-1 block text-gray-500">Family History of Glaucoma</label>
              <div className="flex gap-4">
                {(['Yes', 'No', 'Unknown'] as const).map(opt => (
                  <label key={opt} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
                    <input type="radio" name="glaucoma_family_history" value={opt} checked={glaucomaFamilyHistory === opt} onChange={() => setGlaucomaFamilyHistory(opt)} />
                    {opt}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs mb-1 block text-gray-500">Previously Elevated Eye Pressure (IOP)</label>
              <div className="flex gap-4">
                {(['Yes', 'No', 'Unknown'] as const).map(opt => (
                  <label key={opt} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
                    <input type="radio" name="elevated_iop_history" value={opt} checked={elevatedIopHistory === opt} onChange={() => setElevatedIopHistory(opt)} />
                    {opt}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs mb-1 block text-gray-500">Previous Eye Surgery or Trauma</label>
              <div className="flex gap-4">
                {(['Yes', 'No', 'Unknown'] as const).map(opt => (
                  <label key={opt} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
                    <input type="radio" name="previous_eye_surgery" value={opt} checked={previousEyeSurgery === opt} onChange={() => setPreviousEyeSurgery(opt)} />
                    {opt}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs mb-1 block text-gray-500">Visual Symptoms</label>
              <div className="flex gap-4">
                {(['None', 'Mild', 'Severe'] as const).map(opt => (
                  <label key={opt} className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-700">
                    <input type="radio" name="visual_symptoms" value={opt} checked={visualSymptoms === opt} onChange={() => setVisualSymptoms(opt)} />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div style={elevatedCardStyle}>
          {sectionTitle('Additional Medical Information (Optional)')}
          <div className="space-y-3">
            <div>
              <label className="text-xs mb-1 block text-gray-500">Comorbidities</label>
              <textarea rows={2} placeholder="e.g. Hypertension, kidney disease" className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none" style={inputStyle} value={comorbText} onChange={e => setComorbText(e.target.value)} />
            </div>
            <div>
              <label className="text-xs mb-1 block text-gray-500">Allergies</label>
              <textarea rows={2} placeholder="e.g. Penicillin, latex, peanuts" className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none" style={inputStyle} value={allergiesText} onChange={e => setAllergiesText(e.target.value)} />
            </div>
            <div>
              <label className="text-xs mb-1 block text-gray-500">Notes</label>
              <textarea rows={2} placeholder="Any other relevant notes" className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none" style={inputStyle} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 rounded-xl font-bold text-white text-sm transition-all duration-200 ease-in-out disabled:opacity-60 bg-blue-600 hover:bg-blue-700 cursor-pointer hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
          style={{ boxShadow: '0 8px 24px rgba(59,130,246,0.4)' }}
        >
          {loading ? 'Saving…' : 'Save & Open Patient Workspace'}
        </button>
      </form>
    </div>
  );
}

// ─── Sub-view: Patient Workspace ──────────────────────────────────────────────

function WorkspaceView({
  patient,
  onBack: _onBack,
  onSelectSession,
}: {
  patient: Patient;
  onBack: () => void;
  onSelectSession: (sessionId: string) => void;
}) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<ScreeningSession[]>([]);
  const [creating, setCreating] = useState(false);

  const loadSessions = () => {
    screeningsAPI.getByPatient(patient.id)
      .then(r => setSessions(r.data ?? []))
      .catch(() => toast.error('Failed to load sessions.'));
  };

  useEffect(() => { loadSessions(); }, [patient.id]);

  const handleNewSession = async () => {
    setCreating(true);
    try {
      const resp = await screeningsAPI.create({ patient_id: patient.id, created_by: user?.user_id });
      const created = resp.data as ScreeningSession;
      toast.success('New screening session created.');
      loadSessions();
      if (created?.id) onSelectSession(created.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create session.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-0.5">Patient Workspace</h2>
      <h3 className="text-lg font-semibold mb-1 text-blue-600">{patient.name}</h3>
      <p className="text-xs mb-4 text-gray-500">
        IC/Passport: {patient.ic_passport} · Age: {patient.age ?? '-'} · Sex: {patient.sex ?? '-'} · Phone: {patient.contact_number ?? '-'}
      </p>

      <hr style={{ borderColor: '#e5e7eb', marginBottom: 20 }} />

      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-base font-bold text-gray-900">Screening Sessions</h3>
        <button
          onClick={handleNewSession}
          disabled={creating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white disabled:opacity-60 bg-blue-600 hover:bg-blue-700 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus size={13} /> {creating ? 'Creating…' : 'Start New Screening'}
        </button>
        <button onClick={loadSessions} className="p-1.5 rounded-lg text-gray-500 cursor-pointer hover:bg-gray-100 transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]" style={{ background: '#f3f4f6' }}>
          <RefreshCw size={13} />
        </button>
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-gray-500">No screening sessions yet. Start one with the button above.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => {
            const sessionNo = (s as unknown as Record<string, unknown>).session_number as number ?? '-';
            const sessionDate = (s as unknown as Record<string, unknown>).session_date as string ?? s.created_at;
            return (
              <div key={s.id} style={cardStyle} className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">Session #{String(sessionNo)}</p>
                  <p className="text-xs mt-0.5 text-gray-500">{formatDt(sessionDate)}</p>
                </div>
                <StatusBadge status={s.status} />
                <button
                  onClick={() => onSelectSession(s.id)}
                  className="px-4 py-1.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                >
                  Select
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sub-view: Screening Session ──────────────────────────────────────────────

function SessionView({
  patient,
  sessionId,
  onBack: _onBack,
}: {
  patient: Patient;
  sessionId: string;
  onBack: () => void;
}) {
  const { user } = useAuth();

  const [session, setSession] = useState<ScreeningSession | null>(null);
  const [images, setImages] = useState<RetinalImage[]>([]);
  const [aiResults, setAiResults] = useState<AIResult[]>([]);
  const [doctors, setDoctors] = useState<StaffUser[]>([]);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [leftFile, setLeftFile] = useState<File | null>(null);
  const [rightFile, setRightFile] = useState<File | null>(null);
  const [leftFileKey, setLeftFileKey] = useState(0);
  const [rightFileKey, setRightFileKey] = useState(0);
  const [uploading, setUploading] = useState<'left' | 'right' | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const load = async () => {
    try {
      const [sResp, imgResp, aiResp] = await Promise.all([
        screeningsAPI.getById(sessionId),
        uploadsAPI.getBySession(sessionId),
        aiAPI.getResultsBySession(sessionId),
      ]);
      setSession(sResp.data ?? null);
      setImages(imgResp.data ?? []);
      setAiResults(aiResp.data ?? []);
    } catch {
      toast.error('Failed to load session data.');
    }
  };

  useEffect(() => { load(); }, [sessionId]);

  const status = (session?.status ?? '').toLowerCase();
  const uploadsLocked = ['assigned', 'approved', 'overridden'].includes(status);
  const aiLocked = ['assigned', 'approved', 'overridden'].includes(status);
  const assignLocked = ['approved', 'overridden'].includes(status);

  const leftImg = images.find(i => i.eye_side === 'left') ?? null;
  const rightImg = images.find(i => i.eye_side === 'right') ?? null;
  const canDiagnose = !!leftImg && !!rightImg && !aiLocked;

  // AI results: latest per eye (handle 'eye' OR 'eye_side' field)
  const leftRes = aiResults.filter(r => getEyeSide(r as unknown as Record<string, unknown>) === 'left').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const rightRes = aiResults.filter(r => getEyeSide(r as unknown as Record<string, unknown>) === 'right').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

  const handleUpload = async (side: 'left' | 'right') => {
    const file = side === 'left' ? leftFile : rightFile;
    if (!file) return;
    setUploading(side);
    try {
      await uploadsAPI.uploadRetinalImage(sessionId, side, file);
      toast.success(`${side === 'left' ? 'Left' : 'Right'} eye uploaded successfully.`);
      if (side === 'left') { setLeftFile(null); setLeftFileKey(k => k + 1); }
      else { setRightFile(null); setRightFileKey(k => k + 1); }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(null);
    }
  };

  const handleDiagnose = async () => {
    setDiagnosing(true);
    try {
      await aiAPI.analyze(sessionId);
      toast.success('AI analysis completed.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI analysis failed.');
    } finally {
      setDiagnosing(false);
    }
  };

  const openAssignModal = async () => {
    try {
      const resp = await staffAPI.getDoctors();
      setDoctors(resp.data ?? []);
      if (resp.data && resp.data.length > 0) setSelectedDoctorId(resp.data[0].id);
    } catch {
      toast.error('Could not load doctors list.');
      return;
    }
    setShowAssignModal(true);
  };

  const handleAssign = async () => {
    if (!selectedDoctorId) return;
    setAssigning(true);
    try {
      await screeningsAPI.assignDoctor(sessionId, selectedDoctorId);
      const doc = doctors.find(d => d.id === selectedDoctorId);
      toast.success(`Assigned to ${doc?.name ?? 'doctor'}.`);
      setShowAssignModal(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Assignment failed.');
    } finally {
      setAssigning(false);
    }
  };

  const sessionNo = session ? (session as unknown as Record<string, unknown>).session_number as number ?? '-' : '-';
  const sessionDate = session ? ((session as unknown as Record<string, unknown>).session_date as string ?? session.created_at) : null;

  const leftRef = useRef<HTMLInputElement>(null);
  const rightRef = useRef<HTMLInputElement>(null);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mt-2">Screening Session</h2>
      <p className="text-xs text-gray-500">Patient: {patient.name} · ID: {sessionId.slice(0, 8)}…</p>

      {session && (
        <div className="flex items-center gap-3 mt-2 mb-4">
          <span className="text-sm font-semibold text-gray-900">Session #{String(sessionNo)}</span>
          <StatusBadge status={status} />
          {sessionDate && <span className="text-xs text-gray-500">{formatDt(sessionDate)}</span>}
        </div>
      )}

      {status === 'assigned' && (
        <div className="mb-4 px-4 py-2.5 rounded-xl text-sm" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8' }}>
          This session is assigned to a doctor. Uploads + AI are disabled to preserve evidence.
        </div>
      )}
      {['approved', 'overridden'].includes(status) && (
        <div className="mb-4 px-4 py-2.5 rounded-xl text-sm" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a' }}>
          This session is locked (doctor decision recorded). View-only mode.
        </div>
      )}

      <hr style={{ borderColor: '#e5e7eb', margin: '16px 0' }} />

      {/* Upload section */}
      <h3 className="text-base font-bold text-gray-900 mb-3">Upload / Replace Images</h3>
      {uploadsLocked ? (
        <p className="text-sm mb-4" style={{ color: '#ea580c' }}>Uploads are disabled for this session (status locked).</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 mb-4">
          {(['left', 'right'] as const).map(side => {
            const file = side === 'left' ? leftFile : rightFile;
            const fileKey = side === 'left' ? leftFileKey : rightFileKey;
            const ref = side === 'left' ? leftRef : rightRef;
            return (
              <div key={side} style={elevatedCardStyle}>
                <p className="text-sm font-bold text-gray-900 mb-2">{side === 'left' ? 'Left' : 'Right'} Eye</p>
                <input
                  key={fileKey}
                  ref={ref}
                  type="file"
                  accept=".jpg,.jpeg,.png"
                  className="hidden"
                  id={`file-${side}`}
                  onChange={e => {
                    const f = e.target.files?.[0] ?? null;
                    side === 'left' ? setLeftFile(f) : setRightFile(f);
                  }}
                />
                <label
                  htmlFor={`file-${side}`}
                  className="flex flex-col items-center justify-center w-full py-6 rounded-xl cursor-pointer mb-2 text-sm text-gray-500"
                  style={{ background: '#f9fafb', border: '1px dashed #d1d5db' }}
                >
                  <Upload size={20} className="mb-1 text-gray-400" />
                  {file ? file.name : 'Click to choose image'}
                </label>
                <button
                  onClick={() => handleUpload(side)}
                  disabled={!file || uploading === side}
                  className="w-full py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 bg-blue-600 hover:bg-blue-700 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{ boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }}
                >
                  {uploading === side ? 'Uploading…' : `Upload ${side === 'left' ? 'Left' : 'Right'}`}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Retinal images display */}
      <h3 className="text-base font-bold text-gray-900 mb-3">Retinal Images</h3>
      <div className="grid grid-cols-2 gap-4 mb-4">
        {(['left', 'right'] as const).map(side => {
          const img = side === 'left' ? leftImg : rightImg;
          return (
            <div key={side} style={elevatedCardStyle}>
              <p className="text-sm font-bold text-gray-900 mb-2">{side === 'left' ? 'Left' : 'Right'} Eye</p>
              {img ? (
                <img src={img.image_url} alt={`${side} eye`} className="w-full rounded-lg" style={{ maxHeight: 220, objectFit: 'cover' }} />
              ) : (
                <div className="rounded-lg flex items-center justify-center text-sm text-gray-400" style={{ height: 140, background: '#f9fafb' }}>
                  No image uploaded yet
                </div>
              )}
            </div>
          );
        })}
      </div>

      <hr style={{ borderColor: '#e5e7eb', margin: '16px 0' }} />

      {/* Diagnose button */}
      {aiLocked ? (
        <p className="text-sm mb-4" style={{ color: '#ea580c' }}>AI diagnosis is locked for this session.</p>
      ) : !canDiagnose ? (
        <p className="text-sm mb-4 text-gray-500">Upload both left + right images to enable AI diagnosis.</p>
      ) : null}

      <div className="flex justify-center mb-6">
        <button
          onClick={handleDiagnose}
          disabled={!canDiagnose || diagnosing}
          className="flex items-center gap-2 px-8 py-3 rounded-xl font-bold text-white text-sm disabled:opacity-40 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: canDiagnose ? '#7c3aed' : '#d1d5db', boxShadow: canDiagnose ? '0 8px 24px rgba(124,58,237,0.4)' : 'none' }}
        >
          <Brain size={16} />
          {diagnosing ? 'Analysing…' : 'Diagnose'}
        </button>
      </div>

      {/* AI verdict */}
      {aiResults.length > 0 && (
        <>
          <h3 className="text-base font-bold text-gray-900 mb-1">AI Verdict</h3>
          <p className="text-xs mb-3 text-gray-500">
            Toggle the switch to view Grad-CAM heatmap or original image for both eyes.
          </p>
          <div style={elevatedCardStyle} className="mb-4">
            {/* Images only */}
            <div className="grid grid-cols-2 gap-4 mb-2">
              <EyePanel title="Left Eye Diagnosis" result={leftRes} originalImg={leftImg} showHeatmap={showHeatmap} section="image" />
              <EyePanel title="Right Eye Diagnosis" result={rightRes} originalImg={rightImg} showHeatmap={showHeatmap} section="image" />
            </div>
            {/* Heatmap toggle — right-aligned, below images, above DR stats */}
            <div className="flex justify-end mb-3">
              <HeatmapToggle value={showHeatmap} onChange={setShowHeatmap} />
            </div>
            {/* Stats only */}
            <div className="grid grid-cols-2 gap-4">
              <EyePanel title="Left Eye Diagnosis" result={leftRes} originalImg={leftImg} showHeatmap={showHeatmap} section="stats" />
              <EyePanel title="Right Eye Diagnosis" result={rightRes} originalImg={rightImg} showHeatmap={showHeatmap} section="stats" />
            </div>
          </div>

          {/* Assign doctor action */}
          <h3 className="text-base font-bold text-gray-900 mb-3">Actions</h3>
          <button
            onClick={openAssignModal}
            disabled={assignLocked}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: '#0ea5e9', boxShadow: '0 8px 24px rgba(59,130,246,0.4)' }}
          >
            <UserCheck size={15} /> Assign Doctor
          </button>
          {status === 'assigned' && (
            <p className="text-sm text-gray-500 italic mt-2">Status: Assigned</p>
          )}
          {assignLocked && (
            <p className="text-xs mt-1 text-gray-400">Assignment is locked after approved/overridden.</p>
          )}
        </>
      )}

      {/* Assign Doctor Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-md mx-4 p-6 rounded-2xl" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Assign Doctor</h3>
            {status === 'assigned' && (
              <p className="text-xs mb-3 text-yellow-600">Session already assigned. Selecting a new doctor will replace the current assignment.</p>
            )}
            <label className="text-xs mb-1 block text-gray-500">Select Doctor</label>
            <select
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-4 cursor-pointer"
              style={inputStyle}
              value={selectedDoctorId}
              onChange={e => setSelectedDoctorId(e.target.value)}
            >
              {doctors.map(d => (
                <option key={d.id} value={d.id}>{d.name ?? d.staff_id} — {d.email}</option>
              ))}
            </select>
            <div className="flex gap-3">
              <button
                onClick={handleAssign}
                disabled={assigning}
                className="flex-1 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-60 bg-blue-600 hover:bg-blue-700 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              >
                {assigning ? 'Assigning…' : 'Confirm Assignment'}
              </button>
              <button
                onClick={() => setShowAssignModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-700 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}
              >
                Cancel
              </button>
            </div>
            {/* Suppress unused warning — user identity for audit trail */}
            <p className="hidden">{user?.name}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Appointment helpers ──────────────────────────────────────────────────────

const apptStatusColor: Record<string, [string, string]> = {
  scheduled: ['#dbeafe', '#1d4ed8'],
  completed: ['#dcfce7', '#16a34a'],
  cancelled: ['#fee2e2', '#dc2626'],
  no_show:   ['#f3f4f6', '#6b7280'],
};

function ApptStatusBadge({ status }: { status: string }) {
  const [bg, color] = apptStatusColor[status] ?? ['#f3f4f6', '#6b7280'];
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize" style={{ background: bg, color }}>
      {status.replace('_', ' ')}
    </span>
  );
}

function ApptChip({ appt, onClick, className = '' }: { appt: Appointment; onClick: () => void; className?: string }) {
  const [bg, color] = apptStatusColor[appt.status] ?? ['#f3f4f6', '#6b7280'];
  const d = new Date(new Date(appt.appointment_datetime).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return (
    <button
      onClick={onClick}
      className={`w-full min-w-0 overflow-hidden text-left text-xs px-1.5 py-0.5 rounded-md mb-0.5 font-medium cursor-pointer hover:brightness-90 transition-all duration-150 ${className}`}
      style={{ background: bg, color }}
    >
      <span className="truncate overflow-hidden block">{h}:{m} {appt.patient_name ?? '—'}</span>
    </button>
  );
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatPeriodLabel(date: Date, mode: 'month' | 'week' | 'day'): string {
  if (mode === 'month') {
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  if (mode === 'day') {
    return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  }
  const start = getWeekStart(date);
  const end = addDays(start, 6);
  const s = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const e = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${s} – ${e}`;
}

function formatApptDateTime(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timePart = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${datePart} at ${timePart}`;
}

const APPT_HOURS = Array.from({ length: 11 }, (_, i) => i + 8); // 08:00–18:00
const CAL_DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Book Appointment Modal ───────────────────────────────────────────────────

function BookAppointmentModal({
  currentUserId,
  onClose,
  onSuccess,
}: {
  currentUserId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<StaffUser[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [date, setDate] = useState('');
  const [selectedHour, setSelectedHour] = useState('9');
  const [selectedMinute, setSelectedMinute] = useState('00');
  const [selectedAmPm, setSelectedAmPm] = useState('AM');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    patientsAPI.search(undefined, 500)
      .then(r => setPatients(r.data ?? []))
      .catch(() => {});
    staffAPI.getDoctors()
      .then(r => setDoctors(r.data ?? []))
      .catch(() => {});
  }, []);

  const handleConfirm = async () => {
    if (!selectedPatientId) { toast.error('Please select a patient.'); return; }
    if (!selectedDoctorId) { toast.error('Please assign a doctor.'); return; }
    if (!date) { toast.error('Please select a date.'); return; }
    const hour = parseInt(selectedHour);
    const ampm = selectedAmPm;
    let hour24: number;
    if (ampm === 'AM') {
      hour24 = hour === 12 ? 0 : hour;
    } else {
      hour24 = hour === 12 ? 12 : hour + 12;
    }
    const timeString = `${String(hour24).padStart(2, '0')}:${selectedMinute}`;
    const appointment_datetime = `${date}T${timeString}:00+08:00`;
    if (new Date(appointment_datetime) <= new Date()) {
      toast.error('Appointment must be scheduled in the future.');
      return;
    }
    setLoading(true);
    try {
      await appointmentsAPI.create({
        patient_id: selectedPatientId,
        scheduled_by: currentUserId,
        appointment_datetime,
        notes: notes.trim() || null,
        assigned_doctor_id: selectedDoctorId,
      });
      toast.success('Appointment booked successfully.');
      onSuccess();
    } catch (error: any) {
      console.log('Booking error:', error)
      console.log('error.response:', error?.response)
      console.log('error.response?.status:', error?.response?.status)
      console.log('error.response?.data:', error?.response?.data)

      const status = error?.response?.status
      if (status === 409) {
        toast.error("Appointments must be at least 30 minutes apart. Please choose a different time slot.")
      } else {
        toast.error("Failed to book appointment. Please try again.")
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-md mx-4 p-6 rounded-2xl" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Book Appointment</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 cursor-pointer transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs mb-1 block text-gray-500">Patient *</label>
            <select
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none cursor-pointer"
              style={inputStyle}
              value={selectedPatientId}
              onChange={e => setSelectedPatientId(e.target.value)}
            >
              <option value="">Select patient…</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}>{p.name} — IC: {p.ic_passport}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs mb-1 block text-gray-500">Assign to Doctor *</label>
            <select
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none cursor-pointer"
              style={inputStyle}
              value={selectedDoctorId}
              onChange={e => setSelectedDoctorId(e.target.value)}
            >
              <option value="">Select doctor…</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>{d.name ?? d.staff_id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs mb-1 block text-gray-500">Date *</label>
            <input
              type="date"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none cursor-pointer"
              style={inputStyle}
              value={date}
              min={new Date().toISOString().split('T')[0]}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs mb-1 block text-gray-500">Time *</label>
            <div className="flex border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
              <select
                value={selectedHour}
                onChange={e => setSelectedHour(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border-none outline-none bg-white cursor-pointer"
              >
                {['9','10','11','12','1','2','3','4','5','6'].map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <span className="flex items-center text-gray-500 text-sm px-1">:</span>
              <select
                value={selectedMinute}
                onChange={e => setSelectedMinute(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border-none outline-none bg-white cursor-pointer"
              >
                {['00','15','30','45'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select
                value={selectedAmPm}
                onChange={e => setSelectedAmPm(e.target.value)}
                className="px-3 py-2 text-sm border-none outline-none bg-white border-l border-gray-200 cursor-pointer"
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs mb-1 block text-gray-500">Notes (optional)</label>
            <textarea
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none"
              style={inputStyle}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any relevant notes…"
            />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-60 bg-blue-600 hover:bg-blue-700 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          >
            {loading ? 'Booking…' : 'Confirm Booking'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-700 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Appointment Detail Modal ─────────────────────────────────────────────────

function AppointmentDetailModal({
  appointment,
  onClose,
  onRefresh,
}: {
  appointment: Appointment;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState<'complete' | 'cancel' | null>(null);
  const isCompleteLocked = ['completed', 'cancelled'].includes(appointment.status);
  const isCancelLocked = ['completed', 'cancelled'].includes(appointment.status);

  const update = async (status: 'completed' | 'cancelled') => {
    setLoading(status === 'completed' ? 'complete' : 'cancel');
    try {
      await appointmentsAPI.update(appointment.id, { status });
      toast.success(status === 'completed' ? 'Appointment marked as complete.' : 'Appointment cancelled.');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update appointment.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-md mx-4 p-6 rounded-2xl" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Appointment Details</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"><X size={18} /></button>
        </div>
        <div className="space-y-3 text-sm mb-5">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Patient</p>
            <p className="font-semibold text-gray-900">{appointment.patient_name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Date & Time</p>
            <p className="font-semibold text-gray-900">{formatApptDateTime(appointment.appointment_datetime)}</p>
          </div>
          {appointment.notes && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Notes</p>
              <p className="text-gray-700">{appointment.notes}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Status</p>
            <ApptStatusBadge status={appointment.status} />
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => update('completed')}
            disabled={isCompleteLocked || loading !== null}
            className="flex-1 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-40 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: '#16a34a' }}
          >
            {loading === 'complete' ? 'Updating…' : '✓ Mark Complete'}
          </button>
          <button
            onClick={() => update('cancelled')}
            disabled={isCancelLocked || loading !== null}
            className="flex-1 py-2.5 rounded-xl font-bold text-sm disabled:opacity-40 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5' }}
          >
            {loading === 'cancel' ? 'Updating…' : 'Cancel Appointment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-view: Appointments ───────────────────────────────────────────────────

interface AppointmentsViewProps {
  currentUserId: string;
}

function AppointmentsView({ currentUserId }: AppointmentsViewProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<StaffUser[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showBookModal, setShowBookModal] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);

  const loadAppts = (doctorId: string) => {
    appointmentsAPI.getAll({ assigned_doctor_id: doctorId })
      .then(data => setAppointments(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load appointments.'));
  };

  useEffect(() => {
    staffAPI.getDoctors()
      .then(r => {
        const list = r.data ?? [];
        setDoctors(list);
        if (list.length > 0) setSelectedDoctorId(list[0].id);
      })
      .catch(() => toast.error('Failed to load doctors.'));
  }, []);

  useEffect(() => {
    if (selectedDoctorId) loadAppts(selectedDoctorId);
  }, [selectedDoctorId]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigatePeriod = (dir: -1 | 1) => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (viewMode === 'day') d.setDate(d.getDate() + dir);
      else if (viewMode === 'week') d.setDate(d.getDate() + dir * 7);
      else d.setMonth(d.getMonth() + dir);
      return d;
    });
  };

  const apptForDay = (day: Date) =>
    appointments.filter(a => {
      const localDate = new Date(new Date(a.appointment_datetime).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
      return isSameDay(localDate, day);
    });

  const apptForSlot = (day: Date, hour: number) =>
    appointments.filter(a => {
      const localDate = new Date(new Date(a.appointment_datetime).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
      return isSameDay(localDate, day) && localDate.getHours() === hour;
    });

  // Week grid — currentDate is already a local JS Date; getWeekStart uses local calendar date
  const weekStart = new Date(new Date(currentDate).toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  weekStart.setHours(0, 0, 0, 0);
  const weekStartDay = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - (weekStartDay === 0 ? 6 : weekStartDay - 1));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Month grid
  const yr = currentDate.getFullYear();
  const mo = currentDate.getMonth();
  const firstDay = new Date(yr, mo, 1);
  const lastDay = new Date(yr, mo + 1, 0);
  const pad = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const gridStart = addDays(firstDay, -pad);
  const totalCells = Math.ceil((pad + lastDay.getDate()) / 7) * 7;
  const monthCells = Array.from({ length: totalCells }, (_, i) => addDays(gridStart, i));

  return (
    <div className="p-6">
      {/* Row 1 — heading + book button */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Appointments</h2>
        <button
          onClick={() => setShowBookModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          style={{ boxShadow: '0 8px 24px rgba(59,130,246,0.4)' }}
        >
          <CalendarPlus size={15} /> Set New Appointment
        </button>
      </div>

      {/* Row 2 — nav + doctor filter + view toggle */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigatePeriod(-1)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{ border: '1px solid #e5e7eb' }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => navigatePeriod(1)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{ border: '1px solid #e5e7eb' }}
          >
            <ChevronRight size={16} />
          </button>
          <span className="text-sm font-semibold text-gray-900" style={{ minWidth: 176 }}>
            {formatPeriodLabel(currentDate, viewMode)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="px-3 py-1.5 rounded-lg text-sm outline-none cursor-pointer"
            style={{ ...inputStyle, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}
            value={selectedDoctorId ?? ''}
            onChange={e => setSelectedDoctorId(e.target.value)}
          >
            {doctors.map(d => (
              <option key={d.id} value={d.id}>{d.name ?? d.staff_id}</option>
            ))}
          </select>
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
            {(['month', 'week', 'day'] as const).map((mode, idx) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="px-3 py-1.5 text-xs font-semibold cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: viewMode === mode ? '#2563eb' : '#fff',
                  color: viewMode === mode ? '#fff' : '#6b7280',
                  borderRight: idx < 2 ? '1px solid #e5e7eb' : 'none',
                }}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>

        {/* ── Week view ── */}
        {viewMode === 'week' && (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 640 }}>
              {/* Day headers */}
              <div
                className="grid sticky top-0 bg-white z-10"
                style={{ gridTemplateColumns: '56px repeat(7, 1fr)', borderBottom: '1px solid #e5e7eb' }}
              >
                <div />
                {weekDays.map((day, i) => {
                  const isToday = isSameDay(day, new Date());
                  return (
                    <div key={i} className="text-center py-2 border-l" style={{ borderColor: '#e5e7eb' }}>
                      <p className="text-xs font-bold" style={{ color: isToday ? '#2563eb' : '#6b7280' }}>
                        {CAL_DAY_HEADERS[i]}
                      </p>
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center mx-auto mt-0.5 text-sm font-bold"
                        style={{ background: isToday ? '#2563eb' : 'transparent', color: isToday ? '#fff' : '#111827' }}
                      >
                        {day.getDate()}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Hour rows */}
              {APPT_HOURS.map(hour => (
                <div key={hour} className="grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)', minHeight: 56 }}>
                  <div className="text-right pr-2 text-xs text-gray-400 shrink-0" style={{ paddingTop: 6 }}>
                    {String(hour).padStart(2, '0')}:00
                  </div>
                  {weekDays.map((day, di) => (
                    <div key={di} className="border-t border-l p-1 overflow-hidden min-w-0" style={{ borderColor: '#e5e7eb' }}>
                      {apptForSlot(day, hour).map(a => (
                        <ApptChip key={a.id} appt={a} onClick={() => setSelectedAppointment(a)} />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Month view ── */}
        {viewMode === 'month' && (
          <div>
            <div className="grid grid-cols-7 sticky top-0 bg-white z-10" style={{ borderBottom: '1px solid #e5e7eb' }}>
              {CAL_DAY_HEADERS.map(d => (
                <div key={d} className="text-center text-xs font-bold py-2 text-gray-500">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7" style={{ gridAutoRows: '96px' }}>
              {monthCells.map((day, i) => {
                const inMonth = day.getMonth() === mo;
                const isToday = isSameDay(day, new Date());
                const dayAppts = apptForDay(day);
                return (
                  <div
                    key={i}
                    className="border-b border-r p-1 overflow-hidden"
                    style={{ borderColor: '#e5e7eb', background: inMonth ? '#fff' : '#f9fafb' }}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mb-0.5"
                      style={{
                        background: isToday ? '#2563eb' : 'transparent',
                        color: isToday ? '#fff' : inMonth ? '#111827' : '#9ca3af',
                      }}
                    >
                      {day.getDate()}
                    </div>
                    {dayAppts.slice(0, 2).map(a => (
                      <ApptChip key={a.id} appt={a} onClick={() => setSelectedAppointment(a)} />
                    ))}
                    {dayAppts.length > 2 && (
                      <p className="text-xs text-gray-400">+{dayAppts.length - 2} more</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Day view ── */}
        {viewMode === 'day' && (
          <div>
            <div
              className="py-2 text-center text-sm font-bold sticky top-0 bg-white z-10"
              style={{ borderBottom: '1px solid #e5e7eb', color: '#111827' }}
            >
              {currentDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
            {APPT_HOURS.map(hour => (
              <div key={hour} className="flex border-t" style={{ borderColor: '#e5e7eb', minHeight: 56 }}>
                <div className="w-14 text-right pr-2 text-xs text-gray-400 shrink-0" style={{ paddingTop: 6 }}>
                  {String(hour).padStart(2, '0')}:00
                </div>
                <div className="flex-1 p-1 overflow-hidden min-w-0">
                  {apptForSlot(currentDate, hour).map(a => (
                    <ApptChip key={a.id} appt={a} onClick={() => setSelectedAppointment(a)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showBookModal && (
        <BookAppointmentModal
          currentUserId={currentUserId}
          onClose={() => setShowBookModal(false)}
          onSuccess={() => { setShowBookModal(false); if (selectedDoctorId) loadAppts(selectedDoctorId); }}
        />
      )}
      {selectedAppointment && (
        <AppointmentDetailModal
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
          onRefresh={() => { setSelectedAppointment(null); if (selectedDoctorId) loadAppts(selectedDoctorId); }}
        />
      )}
    </div>
  );
}

// ─── Main: Nurse Dashboard ────────────────────────────────────────────────────

export default function NurseDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<NurseView>({ name: 'home' });
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isDragging, setIsDragging] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [sidebarPatients, setSidebarPatients] = useState<Patient[]>([]);
  const [patientListKey, setPatientListKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      patientsAPI.search(sidebarQuery.trim() || undefined, 30)
        .then(r => setSidebarPatients(r.data ?? []))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [sidebarQuery, patientListKey]);

  const handleLogout = () => { logout(); navigate('/login', { replace: true }); };

  const handleSidebarDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    setIsDragging(true);
    const onMouseMove = (ev: MouseEvent) => {
      setSidebarWidth(Math.min(500, Math.max(200, startWidth + (ev.clientX - startX))));
    };
    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#f9fafb', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Sidebar — hidden on new-patient registration for distraction-free full-screen form */}
      {view.name !== 'new-patient' && (
      <div
        className="flex flex-col shrink-0 h-screen overflow-hidden"
        style={{
          width: isSidebarOpen ? sidebarWidth : 0,
          minWidth: 0,
          background: '#fff',
          borderRight: '1px solid #e5e7eb',
          transition: isDragging ? 'none' : 'width 300ms ease',
          position: 'relative',
        }}
      >
        {/* User info */}
        <div className="px-4 py-4 shrink-0 shadow-md bg-white" style={{ borderBottom: '1px solid #e5e7eb' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}>👤</div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-gray-900 text-sm truncate">{user?.name ?? 'Nurse'}</p>
              <p className="text-xs truncate text-gray-500">{user?.email}</p>
              <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: '#dbeafe', border: '1px solid #93c5fd', color: '#1d4ed8' }}>Nurse</span>
            </div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="shrink-0 p-1 rounded-lg text-gray-400 cursor-pointer hover:brightness-90 transition-all duration-150"
              title="Close sidebar"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>

        {/* Appointments nav item */}
        <div className="px-3 py-2" style={{ borderBottom: '1px solid #f3f4f6' }}>
          <button
            onClick={() => setView({ name: 'appointments' })}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all duration-150 cursor-pointer hover:shadow-sm"
            style={{
              background: view.name === 'appointments' ? '#dbeafe' : 'transparent',
              color: view.name === 'appointments' ? '#1d4ed8' : '#374151',
            }}
            onMouseEnter={e => { if (view.name !== 'appointments') e.currentTarget.style.background = '#f3f4f6'; }}
            onMouseLeave={e => { if (view.name !== 'appointments') e.currentTarget.style.background = 'transparent'; }}
          >
            <CalendarDays size={15} />
            Appointments
          </button>
        </div>

        {/* Patient search + add */}
        <div className="px-3 pt-3 pb-1">
          <p className="text-xs font-bold uppercase tracking-widest mb-2 text-gray-400">Patients</p>
          <div className="flex gap-1.5 mb-1">
            <div className="flex-1 relative focus-within:shadow-md transition-all duration-150">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full pl-7 pr-2 py-1.5 rounded-xl text-xs outline-none"
                style={inputStyle}
                placeholder="Search patient…"
                value={sidebarQuery}
                onChange={e => setSidebarQuery(e.target.value)}
              />
            </div>
            <button
              onClick={() => setView({ name: 'new-patient' })}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0 bg-blue-600 hover:bg-blue-700 cursor-pointer hover:brightness-90 transition-all duration-150 shadow-md hover:shadow-lg hover:scale-110 active:scale-95"
            >
              <Plus size={14} />
            </button>
          </div>
          <p className="text-xs mb-2 text-gray-400">Quick select a patient</p>
        </div>

        {/* Patient list */}
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {sidebarPatients.map(p => (
            <div key={p.id} className="mb-1">
              <button
                onClick={() => setView({ name: 'workspace', patient: p })}
                className="w-full text-left px-3 py-2 rounded-xl text-sm text-gray-900 cursor-pointer"
                style={{ background: '#f9fafb' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                onMouseLeave={e => (e.currentTarget.style.background = '#f9fafb')}
              >
                {p.name}
              </button>
              <p className="text-xs px-3 text-gray-400">IC: {p.ic_passport}</p>
            </div>
          ))}
        </div>

        <hr style={{ borderColor: '#e5e7eb' }} />

        {/* Sign out */}
        <div className="p-3">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-bold cursor-pointer hover:brightness-110 transition-all duration-200 shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#dc2626' }}
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>

        {/* Drag handle — grab right edge to resize sidebar */}
        <div
          onMouseDown={handleSidebarDragStart}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 6,
            height: '100%',
            cursor: 'col-resize',
            zIndex: 20,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.25)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        />
      </div>
      )}

      {/* Right-side wrapper: header + scrollable content column */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top bar */}
        <header
          className="flex-none flex items-center px-3 py-2 border-b border-gray-200"
          style={{ background: '#fff' }}
        >
          {view.name !== 'new-patient' && (
            <button
              onClick={() => setIsSidebarOpen(v => !v)}
              className="p-1.5 rounded-xl text-gray-500 cursor-pointer hover:bg-gray-100 hover:opacity-70 transition-all duration-150"
              style={{ background: '#f3f4f6' }}
              title="Toggle sidebar"
            >
              <Menu size={16} />
            </button>
          )}
          {(view.name === 'workspace' || view.name === 'appointments' || view.name === 'new-patient') && (
            <button
              onClick={() => setView({ name: 'home' })}
              className="ml-3 text-sm text-blue-600 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              ← Back to Patients
            </button>
          )}
          {view.name === 'session' && (
            <button
              onClick={() => setView({ name: 'workspace', patient: view.patient })}
              className="ml-3 text-sm text-blue-600 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              ← Back to Workspace
            </button>
          )}
        </header>
        <main className="flex-1 overflow-y-auto min-w-0">
        {view.name === 'home' && (
          <div
            className="flex flex-col items-center justify-center h-full text-center px-4"
            style={{
              backgroundImage:
                'linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
            }}
          >
            <div className="bg-white rounded-2xl shadow-xl px-10 py-10 flex flex-col items-center">
            {/* Icon badge */}
            <div className="bg-blue-50 p-5 rounded-full mb-6">
              <Users className="w-12 h-12 text-blue-600" />
            </div>

            {/* Heading */}
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">
              Visionary AI Screening Dashboard
            </h1>

            {/* Subtext */}
            <p className="text-gray-500 text-center max-w-md mt-3 mb-8 leading-relaxed">
              Select an existing patient from the sidebar to view their records, or register a new patient to begin a screening session.
            </p>

            {/* CTA button */}
            <button
              onClick={() => setView({ name: 'new-patient' })}
              className="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 hover:-translate-y-0.5 transition-all duration-200 ease-in-out cursor-pointer hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
              style={{ boxShadow: '0 8px 24px rgba(59,130,246,0.4)' }}
            >
              <Plus size={15} /> Add New Patient
            </button>
            </div>
          </div>
        )}
        {view.name === 'new-patient' && (
          <NewPatientView
            onBack={() => setView({ name: 'home' })}
            onCreated={p => { setPatientListKey(k => k + 1); setView({ name: 'workspace', patient: p }); }}
          />
        )}
        {view.name === 'workspace' && (
          <WorkspaceView
            patient={view.patient}
            onBack={() => setView({ name: 'home' })}
            onSelectSession={sid => setView({ name: 'session', patient: view.patient, sessionId: sid })}
          />
        )}
        {view.name === 'session' && (
          <SessionView
            patient={view.patient}
            sessionId={view.sessionId}
            onBack={() => view.name === 'session' && setView({ name: 'workspace', patient: view.patient })}
          />
        )}
        {view.name === 'appointments' && (
          <AppointmentsView currentUserId={user!.user_id} />
        )}
        </main>
      </div>
    </div>
  );
}
