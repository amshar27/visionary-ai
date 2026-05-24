import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, LogOut, Search, Menu, ChevronLeft, CalendarDays, X, ChevronRight, Mail, Pencil, Eraser } from 'lucide-react';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../context/AuthContext';
import { screeningsAPI, uploadsAPI, aiAPI, appointmentsAPI, patientsAPI } from '../services/api';
import { formatDt, getEyeSide, fmtConfidence } from '../utils/format';
import type { ScreeningSession, RetinalImage, AIResult, DoctorReview, RAGSummaryResponse, Appointment, Patient } from '../types';
import type { User } from '../types';
import RagReportEditor, { type RagReportEditorHandle } from '../components/RagReportEditor';
import Pagination from '../components/Pagination';
import AppHeader from '../components/AppHeader';

const PAGE_SIZE = 15;

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d1d5db',
  color: '#111827',
};

const elevatedCardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 14,
  padding: '16px 20px',
  boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.08)',
};

// ─── Helper: extract patient name from session (handles nested join or flat) ──

function extractPatientName(s: ScreeningSession): string {
  const raw = s as unknown as Record<string, unknown>;
  const nested = raw.patients as Record<string, unknown> | undefined;
  return (
    (nested?.name as string) ??
    (raw.patient_name as string) ??
    s.patient?.name ??
    'Unknown'
  );
}

function extractAssignedByName(s: ScreeningSession): string {
  const raw = s as unknown as Record<string, unknown>;
  const nested = raw.created_by_user as Record<string, unknown> | undefined;
  return (
    (nested?.name as string) ??
    (raw.assigned_by_name as string) ??
    '-'
  );
}

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
        <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: value ? 22 : 2 }} />
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
            <div className="rounded-lg flex items-center justify-center text-sm text-gray-400" style={{ height: 180, background: '#f3f4f6' }}>
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
              <p><span className="font-semibold text-gray-900">Disease Type:</span> {result.disease_type ?? ({'cataract': 'Cataract', 'glaucoma': 'Glaucoma', 'none': 'No Disease Detected', 'mild': 'Diabetic Retinopathy', 'moderate': 'Diabetic Retinopathy', 'severe': 'Diabetic Retinopathy', 'proliferative': 'Diabetic Retinopathy'} as Record<string, string>)[result.dr_severity?.toLowerCase()] ?? 'Not specified'}</p>
              <p><span className="font-semibold text-gray-900">Severity:</span> {['cataract', 'glaucoma'].includes(result.dr_severity?.toLowerCase()) ? 'N/A' : (result.severity_label ?? result.dr_severity ?? 'Not specified')}</p>
              <p><span className="font-semibold text-gray-900">Referable:</span> {String(result.referable)}</p>
              <p><span className="font-semibold text-gray-900">Confidence:</span> {fmtConfidence(result.confidence_score)}</p>
              <p><span className="font-semibold text-gray-900">Follow-up:</span> {result.follow_up_interval ?? '-'}</p>
              {result.llm_summary && (
                <div className="mt-2 p-2 rounded-lg text-xs shadow-md" style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
                  <p className="font-semibold text-gray-900 mb-1">AI Analysis:</p>
                  <p className="text-gray-600">{result.llm_summary}</p>
                </div>
              )}
              {result.warnings?.length > 0 && !['cataract', 'glaucoma'].includes(result.dr_severity?.toLowerCase()) && (
                <div className="mt-1">
                  <p className="font-semibold text-yellow-600 text-xs">Warnings:</p>
                  {result.warnings.map((w, i) => <p key={i} className="text-xs text-yellow-700">— {w}</p>)}
                </div>
              )}
            </div>
          )}
          {!result && <p className="text-sm text-gray-400">No AI result for this eye.</p>}
        </>
      )}
    </div>
  );
}

// ─── View type ────────────────────────────────────────────────────────────────

type ReturnTo =
  | { kind: 'inbox' }
  | { kind: 'patient-history'; patient_id: string; patient_name: string };

type DoctorView =
  | { name: 'inbox' }
  | { name: 'patient-history'; patient_id: string; patient_name: string }
  | { name: 'all-patients' }
  | { name: 'review'; sessionId: string; patientName: string; returnTo: ReturnTo }
  | { name: 'appointments' };

// ─── Sub-view: Doctor Inbox ───────────────────────────────────────────────────

function InboxView({
  user,
  onOpen,
  clearedIds,
  onClear,
}: {
  user: User;
  onOpen: (s: ScreeningSession) => void;
  clearedIds: Set<string>;
  onClear: (idsToClear: string[]) => void;
}) {
  const [sessions, setSessions] = useState<ScreeningSession[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLDivElement | null>(null);

  const load = () => {
    setLoading(true);
    screeningsAPI.getAssignedToDoctor(user.user_id)
      .then(r => setSessions(r.data ?? []))
      .catch(() => toast.error('Could not load inbox.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [user.user_id]);

  const visibleSessions = useMemo(
    () => sessions.filter(s => !clearedIds.has(s.id)),
    [sessions, clearedIds]
  );

  const filtered = statusFilter === 'all'
    ? visibleSessions
    : visibleSessions.filter(s => s.status === statusFilter);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > totalPages) setPage(1);
  }, [filtered.length, page]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const clearableIds = useMemo(
    () => visibleSessions
      .filter(s => ['approved', 'overridden'].includes(s.status?.toLowerCase()))
      .map(s => s.id),
    [visibleSessions]
  );
  const clearableCount = clearableIds.length;

  const handleConfirmClear = () => {
    onClear(clearableIds);
    toast.success(`Cleared ${clearableCount} session(s) from inbox`);
    setShowClearConfirm(false);
    setPage(1);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-bold text-gray-900">Doctor Inbox</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => clearableCount > 0 && setShowClearConfirm(true)}
            disabled={clearableCount === 0}
            title={clearableCount === 0 ? 'No finished sessions to clear' : 'Hide approved/overridden sessions from inbox'}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold ${
              clearableCount === 0
                ? 'bg-gray-200 text-gray-400 border-none opacity-60 cursor-not-allowed shadow-none'
                : 'bg-red-500 hover:bg-red-600 text-white border-none shadow-sm hover:shadow-md transition-all duration-150 cursor-pointer'
            }`}
          >
            <Eraser size={13} /> Clear
          </button>
          <button onClick={load} className="p-2 rounded-xl text-gray-500 cursor-pointer hover:bg-gray-100 transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]" style={{ background: '#f3f4f6' }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <p className="text-sm mb-4 text-gray-500">These are screening sessions assigned to you.</p>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status:</span>
        {['all', 'assigned', 'approved', 'overridden'].map(opt => (
          <button
            key={opt}
            onClick={() => { setStatusFilter(opt); setPage(1); }}
            className="px-3 py-1 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer hover:brightness-90 hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: statusFilter === opt ? '#3b82f6' : '#f3f4f6',
              color: statusFilter === opt ? '#fff' : '#6b7280',
              border: '1px solid ' + (statusFilter === opt ? '#3b82f6' : '#e5e7eb'),
            }}
          >
            {opt}
          </button>
        ))}
      </div>

      <hr style={{ borderColor: '#e5e7eb', marginBottom: 12 }} />

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && filtered.length === 0 && (
        <p className="text-sm text-gray-500">No sessions found for the selected filter.</p>
      )}
      {!loading && filtered.length > 0 && (
        <div ref={tableRef}>
          <p className="text-xs mb-3 text-gray-400">
            {filtered.length > PAGE_SIZE
              ? `Showing ${paginated.length} of ${filtered.length} session(s).`
              : `Showing ${filtered.length} session(s).`}
          </p>
          <div className="grid text-xs font-bold uppercase tracking-wide pb-2 mb-1 text-gray-400" style={{ gridTemplateColumns: '90px 1fr 1fr 1fr 100px 90px', borderBottom: '1px solid #e5e7eb' }}>
            <span>Session No.</span><span>Date</span><span>Patient</span><span>Assigned By</span><span>Status</span><span>Action</span>
          </div>
          {paginated.map(s => {
            const raw = s as unknown as Record<string, unknown>;
            const sessionNo = raw.session_number as number ?? '-';
            const sessionDate = raw.session_date as string ?? s.created_at;
            const patientName = extractPatientName(s);
            const assignedBy = extractAssignedByName(s);
            const isFinalized = ['approved', 'overridden'].includes(s.status?.toLowerCase());
            return (
              <div key={s.id} className="grid items-center py-3" style={{ gridTemplateColumns: '90px 1fr 1fr 1fr 100px 90px', borderBottom: '1px solid #f3f4f6' }}>
                <span className="text-sm text-gray-900">{String(sessionNo)}</span>
                <span className="text-sm text-gray-600">{formatDt(sessionDate)}</span>
                <span className="text-sm text-gray-900 font-medium">{patientName}</span>
                <span className="text-sm text-gray-600">{assignedBy}</span>
                <StatusBadge status={s.status} />
                <button
                  onClick={() => onOpen(s)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
                  style={
                    isFinalized
                      ? { background: '#fff', border: '1px solid #d1d5db', color: '#374151' }
                      : { background: '#2563eb', color: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }
                  }
                  onMouseEnter={e => { e.currentTarget.style.background = isFinalized ? '#f9fafb' : '#1d4ed8'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isFinalized ? '#fff' : '#2563eb'; }}
                >
                  {isFinalized ? 'View' : 'Open'}
                </button>
              </div>
            );
          })}
          <Pagination
            totalItems={filtered.length}
            itemsPerPage={PAGE_SIZE}
            currentPage={page}
            onPageChange={setPage}
            scrollTargetRef={tableRef}
          />
          <p className="text-xs mt-3 text-gray-400">Tip: Approved/overridden sessions open in read-only mode.</p>
        </div>
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-sm mx-4 p-6 rounded-2xl bg-white" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div className="flex items-center gap-3 mb-3"><Eraser size={18} className="text-gray-600" /><h3 className="text-lg font-bold text-gray-900">Clear finished sessions from inbox?</h3></div>
            <p className="text-sm text-gray-600 mb-3">This will hide all approved and overridden sessions from your inbox view. They will remain accessible by selecting the patient from the sidebar. Assigned sessions will not be affected.</p>
            <p className="text-sm font-bold text-gray-900 mb-5">{clearableCount} session(s) will be cleared.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-700 cursor-pointer hover:brightness-90 transition-all duration-200" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}>Cancel</button>
              <button onClick={handleConfirmClear} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white cursor-pointer hover:brightness-110 transition-all duration-200" style={{ background: '#2563eb' }}>Clear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-view: Patient History (per-patient session list) ────────────────────

function PatientHistoryView({
  user,
  patientId,
  patientName,
  onOpen,
}: {
  user: User;
  patientId: string;
  patientName: string;
  onOpen: (s: ScreeningSession) => void;
}) {
  const [sessions, setSessions] = useState<ScreeningSession[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLDivElement | null>(null);

  const load = () => {
    setLoading(true);
    screeningsAPI.getAssignedToDoctor(user.user_id)
      .then(r => setSessions(r.data ?? []))
      .catch(() => toast.error('Could not load patient history.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); setPage(1); }, [user.user_id, patientId]);

  const patientSessions = useMemo(() => sessions.filter(s => {
    const enriched = s as unknown as Record<string, unknown>;
    const pid =
      (enriched['patient_id'] as string | undefined) ??
      ((enriched['patients'] as Record<string, unknown> | undefined)?.['id'] as string | undefined);
    return pid === patientId;
  }), [sessions, patientId]);

  const filtered = statusFilter === 'all'
    ? patientSessions
    : patientSessions.filter(s => s.status === statusFilter);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > totalPages) setPage(1);
  }, [filtered.length, page]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-bold text-gray-900">{patientName} — Screening History</h2>
        <button onClick={load} className="p-2 rounded-xl text-gray-500 cursor-pointer hover:bg-gray-100 transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]" style={{ background: '#f3f4f6' }}>
          <RefreshCw size={14} />
        </button>
      </div>
      <p className="text-sm mb-4 text-gray-500">All screening sessions assigned to you for this patient (including cleared ones).</p>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status:</span>
        {['all', 'assigned', 'approved', 'overridden'].map(opt => (
          <button
            key={opt}
            onClick={() => { setStatusFilter(opt); setPage(1); }}
            className="px-3 py-1 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer hover:brightness-90 hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: statusFilter === opt ? '#3b82f6' : '#f3f4f6',
              color: statusFilter === opt ? '#fff' : '#6b7280',
              border: '1px solid ' + (statusFilter === opt ? '#3b82f6' : '#e5e7eb'),
            }}
          >
            {opt}
          </button>
        ))}
      </div>

      <hr style={{ borderColor: '#e5e7eb', marginBottom: 12 }} />

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && filtered.length === 0 && (
        <p className="text-sm text-gray-500">No sessions found for the selected filter.</p>
      )}
      {!loading && filtered.length > 0 && (
        <div ref={tableRef}>
          <p className="text-xs mb-3 text-gray-400">
            {filtered.length > PAGE_SIZE
              ? `Showing ${paginated.length} of ${filtered.length} session(s).`
              : `Showing ${filtered.length} session(s).`}
          </p>
          <div className="grid text-xs font-bold uppercase tracking-wide pb-2 mb-1 text-gray-400" style={{ gridTemplateColumns: '90px 1fr 1fr 1fr 100px 90px', borderBottom: '1px solid #e5e7eb' }}>
            <span>Session No.</span><span>Date</span><span>Patient</span><span>Assigned By</span><span>Status</span><span>Action</span>
          </div>
          {paginated.map(s => {
            const raw = s as unknown as Record<string, unknown>;
            const sessionNo = raw.session_number as number ?? '-';
            const sessionDate = raw.session_date as string ?? s.created_at;
            const pName = extractPatientName(s);
            const assignedBy = extractAssignedByName(s);
            const isFinalized = ['approved', 'overridden'].includes(s.status?.toLowerCase());
            return (
              <div key={s.id} className="grid items-center py-3" style={{ gridTemplateColumns: '90px 1fr 1fr 1fr 100px 90px', borderBottom: '1px solid #f3f4f6' }}>
                <span className="text-sm text-gray-900">{String(sessionNo)}</span>
                <span className="text-sm text-gray-600">{formatDt(sessionDate)}</span>
                <span className="text-sm text-gray-900 font-medium">{pName}</span>
                <span className="text-sm text-gray-600">{assignedBy}</span>
                <StatusBadge status={s.status} />
                <button
                  onClick={() => onOpen(s)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
                  style={
                    isFinalized
                      ? { background: '#fff', border: '1px solid #d1d5db', color: '#374151' }
                      : { background: '#2563eb', color: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }
                  }
                  onMouseEnter={e => { e.currentTarget.style.background = isFinalized ? '#f9fafb' : '#1d4ed8'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isFinalized ? '#fff' : '#2563eb'; }}
                >
                  {isFinalized ? 'View' : 'Open'}
                </button>
              </div>
            );
          })}
          <Pagination
            totalItems={filtered.length}
            itemsPerPage={PAGE_SIZE}
            currentPage={page}
            onPageChange={setPage}
            scrollTargetRef={tableRef}
          />
          <p className="text-xs mt-3 text-gray-400">Tip: Approved/overridden sessions open in read-only mode.</p>
        </div>
      )}
    </div>
  );
}

// ─── Severity options helper ─────────────────────────────────────────────────

function getSeverityOptions(diseaseType: string, diseaseDetected: string): string[] {
  if (diseaseDetected === 'No') return ['N/A'];
  switch (diseaseType) {
    case 'Diabetic Retinopathy':
      return ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative'];
    case 'Cataract':
      return ['Mild Cataract', 'Moderate Cataract', 'Severe Cataract'];
    case 'Glaucoma':
      return ['Suspect', 'Mild Glaucoma', 'Moderate Glaucoma', 'Severe Glaucoma'];
    case 'N/A':
    default:
      return ['N/A'];
  }
}

// ─── Sub-view: Doctor Review ──────────────────────────────────────────────────

function ReviewView({
  sessionId,
  patientName: _patientName,
  onBack,
  user,
  refreshKey,
  isEditingReport,
  setIsEditingReport,
}: {
  sessionId: string;
  patientName: string;
  onBack: () => void;
  user: User;
  refreshKey?: number;
  isEditingReport: boolean;
  setIsEditingReport: (v: boolean) => void;
}) {
  const [session, setSession] = useState<ScreeningSession | null>(null);
  const [images, setImages] = useState<RetinalImage[]>([]);
  const [aiResults, setAiResults] = useState<AIResult[]>([]);
  const [latestReview, setLatestReview] = useState<DoctorReview | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [ragResult, setRagResult] = useState<RAGSummaryResponse | null>(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [showSaveReportConfirm, setShowSaveReportConfirm] = useState(false);
  const reportEditorRef = useRef<RagReportEditorHandle>(null);

  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [leftEditing, setLeftEditing] = useState(false);
  const [rightEditing, setRightEditing] = useState(false);
  const [leftEdited, setLeftEdited] = useState(false);
  const [rightEdited, setRightEdited] = useState(false);

  const [leftEditForm, setLeftEditForm] = useState({ disease_detected: 'Yes', disease_type: 'Diabetic Retinopathy', severity: 'No DR' });
  const [rightEditForm, setRightEditForm] = useState({ disease_detected: 'Yes', disease_type: 'Diabetic Retinopathy', severity: 'No DR' });

  const [leftConfirmed, setLeftConfirmed] = useState<{ disease_type: string; severity: string } | null>(null);
  const [rightConfirmed, setRightConfirmed] = useState<{ disease_type: string; severity: string } | null>(null);

  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false);
  const [pendingConfirmEye, setPendingConfirmEye] = useState<'left' | 'right' | null>(null);

  const load = async () => {
    try {
      const [sResp, imgResp, aiResp, reviewResp, ragResp] = await Promise.all([
        screeningsAPI.getById(sessionId),
        uploadsAPI.getBySession(sessionId),
        aiAPI.getResultsBySession(sessionId),
        screeningsAPI.getLatestReview(sessionId),
        aiAPI.getRagSummary(sessionId),
      ]);
      setSession(sResp.data ?? null);
      setImages(imgResp.data ?? []);
      setAiResults(aiResp.data ?? []);
      setLatestReview(reviewResp.data ?? null);
      if (ragResp.rag_summary) {
        setRagResult({ rag_summary: ragResp.rag_summary, references: [] });
      }
    } catch {
      toast.error('Failed to load review data.');
    }
  };

  useEffect(() => {
    load();
    setLeftEditing(false);
    setRightEditing(false);
    setLeftEdited(false);
    setRightEdited(false);
    setLeftEditForm({ disease_detected: 'Yes', disease_type: 'Diabetic Retinopathy', severity: 'No DR' });
    setRightEditForm({ disease_detected: 'Yes', disease_type: 'Diabetic Retinopathy', severity: 'No DR' });
    setLeftConfirmed(null);
    setRightConfirmed(null);
    setShowOverrideConfirm(false);
    setPendingConfirmEye(null);
    setIsEditingReport(false);
    setShowSaveReportConfirm(false);
  }, [sessionId, refreshKey]);

  const status = (session?.status ?? '').toLowerCase();
  const isLocked = ['approved', 'overridden'].includes(status);
  const hasResults = aiResults.length > 0;

  const leftImg = images.find(i => i.eye_side === 'left') ?? null;
  const rightImg = images.find(i => i.eye_side === 'right') ?? null;
  const leftRes = aiResults.filter(r => getEyeSide(r as unknown as Record<string, unknown>) === 'left').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const rightRes = aiResults.filter(r => getEyeSide(r as unknown as Record<string, unknown>) === 'right').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      await screeningsAPI.submitReview(sessionId, { doctor_id: user.user_id, decision: 'approved' });
      toast.success('Approved. Session is now locked.');
      onBack();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approve failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnterEditMode = (eye: 'left' | 'right') => {
    const result = aiResults.find(r => getEyeSide(r as unknown as Record<string, unknown>) === eye);
    if (!result) return;
    const diseaseDetected = result.disease_detected ? 'Yes' : 'No';
    const diseaseType = result.disease_type ?? 'Diabetic Retinopathy';
    const severityOptions = getSeverityOptions(diseaseType, diseaseDetected);
    const severity = result.severity_label ?? severityOptions[0];
    const formValue = { disease_detected: diseaseDetected, disease_type: diseaseType, severity };
    if (eye === 'left') { setLeftEditForm(formValue); setLeftEditing(true); }
    else { setRightEditForm(formValue); setRightEditing(true); }
  };

  const handleEditConfirm = (eye: 'left' | 'right') => {
    setPendingConfirmEye(eye);
    setShowOverrideConfirm(true);
  };

  const handleOverrideConfirmed = async () => {
    const eye = pendingConfirmEye;
    if (!eye) return;
    setShowOverrideConfirm(false);
    setPendingConfirmEye(null);
    const form = eye === 'left' ? leftEditForm : rightEditForm;
    const result = aiResults.find(r => getEyeSide(r as unknown as Record<string, unknown>) === eye);
    if (!result || !result.id) { toast.error(`No AI result found for ${eye} eye`); return; }
    try {
      await aiAPI.overrideAiResult(result.id, {
        disease_detected: form.disease_detected === 'Yes',
        disease_type: form.disease_type,
        severity_label: form.severity,
      });
      setAiResults(prev => prev.map(r => {
        if (getEyeSide(r as unknown as Record<string, unknown>) === eye) {
          return {
            ...r,
            disease_detected: form.disease_detected === 'Yes',
            disease_type: form.disease_type,
            severity_label: form.severity,
            referable: undefined as unknown as boolean,
            confidence_score: undefined as unknown as number,
            follow_up_interval: undefined as unknown as string,
            llm_summary: undefined as unknown as string,
            warnings: [],
          };
        }
        return r;
      }));
      if (eye === 'left') { setLeftEditing(false); setLeftEdited(true); setLeftConfirmed({ disease_type: form.disease_type, severity: form.severity }); }
      else { setRightEditing(false); setRightEdited(true); setRightConfirmed({ disease_type: form.disease_type, severity: form.severity }); }
      setRagResult(null);
      toast.success(`${eye.charAt(0).toUpperCase() + eye.slice(1)} eye result updated`);
      toast('Clinical summary cleared — click Regenerate to update it', { icon: 'ℹ️' });
    } catch {
      toast.error(`Failed to update ${eye} eye result`);
    }
  };

  const handleSubmit = async () => {
    const leftResult = aiResults.find(r => getEyeSide(r as unknown as Record<string, unknown>) === 'left');
    const rightResult = aiResults.find(r => getEyeSide(r as unknown as Record<string, unknown>) === 'right');
    const finalGradeLeft = leftConfirmed?.severity ?? leftResult?.severity_label ?? leftResult?.dr_severity ?? null;
    const finalGradeRight = rightConfirmed?.severity ?? rightResult?.severity_label ?? rightResult?.dr_severity ?? null;
    setSubmitting(true);
    try {
      await screeningsAPI.submitReview(sessionId, {
        doctor_id: user.user_id,
        decision: 'overridden',
        override_reason: 'Doctor manually edited AI results for one or more eyes.',
        final_dr_grade_left: finalGradeLeft ?? undefined,
        final_dr_grade_right: finalGradeRight ?? undefined,
      });
      toast.success('Session submitted successfully');
      onBack();
    } catch {
      toast.error('Failed to submit session');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRAG = async () => {
    setRagLoading(true);
    try {
      const result = await aiAPI.summariseRAGCrew(sessionId);
      setRagResult(result);
      toast.success('Clinical summary generated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate summary.');
    } finally {
      setRagLoading(false);
    }
  };

  const handleSaveReportEdits = async () => {
    try {
      const markdown = reportEditorRef.current?.getMarkdown() ?? '';
      await aiAPI.updateRagSummary(sessionId, markdown);
      setRagResult({ rag_summary: markdown, references: ragResult?.references ?? [] });
      setIsEditingReport(false);
      setShowSaveReportConfirm(false);
      toast.success('Clinical summary saved.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to save report.');
    }
  };

  const handleSendReport = async () => {
    if (!ragResult || !patientEmail) return;
    setSendingReport(true);
    try {
      const pName = session ? extractPatientName(session) : 'Patient';
      await screeningsAPI.sendReport(sessionId, {
        patient_email: patientEmail,
        report_html: ragResult.rag_summary,
        patient_name: pName,
      });
      toast.success('Report sent to patient.');
    } catch {
      toast.error('Failed to send report. Please try again.');
    } finally {
      setSendingReport(false);
      setShowSendConfirm(false);
    }
  };

  const raw = session as unknown as Record<string, unknown> | null;
  const sessionNo = raw?.session_number as number ?? '-';
  const sessionDate = raw?.session_date as string ?? session?.created_at;
  const patientName = session ? extractPatientName(session) : 'Unknown patient';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patientEmail = (session as any)?.patients?.email as string | null;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mt-1">Doctor Review</h2>
      <p className="text-xs mb-2 text-gray-400">Session ID: {sessionId.slice(0, 8)}…</p>

      <div className="flex items-center gap-3 mb-1">
        <span className="text-lg font-semibold text-gray-900">Session #{String(sessionNo)} — {patientName}</span>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <StatusBadge status={status} />
        {sessionDate && <span className="text-xs text-gray-400">{formatDt(sessionDate)}</span>}
      </div>

      {isLocked && (
        <div className="mb-4 px-4 py-2.5 rounded-xl text-sm" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a' }}>
          This session is locked (doctor decision recorded). View-only mode.
        </div>
      )}

      <hr style={{ borderColor: '#e5e7eb', margin: '16px 0' }} />

      <h3 className="text-base font-bold text-gray-900 mb-1">AI Verdict</h3>
      {!hasResults && (
        <p className="text-sm mb-4" style={{ color: '#ea580c' }}>No AI results found for this session yet.</p>
      )}
      {hasResults && (
        <>
          <p className="text-xs mb-3 text-gray-500">Toggle the switch to view Grad-CAM heatmap or original image for both eyes.</p>
          <div className="grid grid-cols-2 gap-4 mb-2">
            <div style={elevatedCardStyle}><EyePanel title="Left Eye Diagnosis" result={leftRes} originalImg={leftImg} showHeatmap={showHeatmap} section="image" /></div>
            <div style={elevatedCardStyle}><EyePanel title="Right Eye Diagnosis" result={rightRes} originalImg={rightImg} showHeatmap={showHeatmap} section="image" /></div>
          </div>
          <div className="flex justify-end mb-3">
            <HeatmapToggle value={showHeatmap} onChange={setShowHeatmap} />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-3">
            {/* ── Left Eye Widget ── */}
            <div style={elevatedCardStyle}>
              {leftEditing ? (
                <div>
                  <h4 className="text-sm font-bold text-gray-900 mb-3">Left Eye Diagnosis — Edit</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Disease Detected</label>
                      <select value={leftEditForm.disease_detected} onChange={(e) => { const val = e.target.value; setLeftEditForm(prev => ({ ...prev, disease_detected: val, disease_type: val === 'No' ? 'N/A' : prev.disease_type, severity: getSeverityOptions(val === 'No' ? 'N/A' : prev.disease_type, val)[0] })); }} className="w-full px-3 py-2 rounded-xl text-sm outline-none cursor-pointer" style={inputStyle}>
                        <option>Yes</option><option>No</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Disease Type</label>
                      <select value={leftEditForm.disease_type} disabled={leftEditForm.disease_detected === 'No'} onChange={(e) => { const val = e.target.value; setLeftEditForm(prev => ({ ...prev, disease_type: val, severity: getSeverityOptions(val, prev.disease_detected)[0] })); }} className="w-full px-3 py-2 rounded-xl text-sm outline-none cursor-pointer disabled:opacity-50" style={inputStyle}>
                        <option>Diabetic Retinopathy</option><option>Cataract</option><option>Glaucoma</option><option>N/A</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Severity</label>
                      <select value={leftEditForm.severity} onChange={(e) => setLeftEditForm(prev => ({ ...prev, severity: e.target.value }))} className="w-full px-3 py-2 rounded-xl text-sm outline-none cursor-pointer" style={inputStyle}>
                        {getSeverityOptions(leftEditForm.disease_type, leftEditForm.disease_detected).map(opt => <option key={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setLeftEditing(false)} className="flex-1 py-2 rounded-xl text-sm font-semibold text-gray-700 cursor-pointer hover:brightness-90 transition-all duration-200" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}>Cancel</button>
                      <button onClick={() => handleEditConfirm('left')} className="flex-1 py-2 rounded-xl text-sm font-bold text-white cursor-pointer hover:brightness-110 transition-all duration-200" style={{ background: '#f97316' }}>Confirm</button>
                    </div>
                  </div>
                </div>
              ) : leftEdited ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-sm font-bold text-gray-900">Left Eye Diagnosis</h4>
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">Doctor Edited</span>
                  </div>
                  <div className="space-y-1 text-sm text-gray-600">
                    <p><span className="font-semibold text-gray-900">Disease Detected:</span> {leftRes?.disease_detected ? 'Yes' : 'No'}</p>
                    <p><span className="font-semibold text-gray-900">Disease Type:</span> {leftRes?.disease_type ?? '-'}</p>
                    <p><span className="font-semibold text-gray-900">Severity:</span> {leftRes?.severity_label ?? '-'}</p>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  {!isLocked && (
                    <button onClick={() => ragResult ? handleEnterEditMode('left') : undefined} disabled={!ragResult} title={!ragResult ? 'Generate Clinical Report Summary first' : undefined} className={`absolute top-0 right-0 text-xs px-3 py-1.5 rounded-lg font-semibold text-white transition-all duration-200 ${ragResult ? 'cursor-pointer hover:scale-[1.05] active:scale-[0.97] hover:brightness-110' : 'cursor-not-allowed opacity-40 grayscale'}`} style={ragResult ? { background: 'linear-gradient(135deg, #dc2626 0%, #ea580c 100%)', boxShadow: '0 4px 14px rgba(220,38,38,0.4)' } : { background: 'linear-gradient(135deg, #dc2626 0%, #ea580c 100%)' }}>Edit</button>
                  )}
                  <EyePanel title="Left Eye Diagnosis" result={leftRes} originalImg={leftImg} showHeatmap={showHeatmap} section="stats" />
                </div>
              )}
            </div>

            {/* ── Right Eye Widget ── */}
            <div style={elevatedCardStyle}>
              {rightEditing ? (
                <div>
                  <h4 className="text-sm font-bold text-gray-900 mb-3">Right Eye Diagnosis — Edit</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Disease Detected</label>
                      <select value={rightEditForm.disease_detected} onChange={(e) => { const val = e.target.value; setRightEditForm(prev => ({ ...prev, disease_detected: val, disease_type: val === 'No' ? 'N/A' : prev.disease_type, severity: getSeverityOptions(val === 'No' ? 'N/A' : prev.disease_type, val)[0] })); }} className="w-full px-3 py-2 rounded-xl text-sm outline-none cursor-pointer" style={inputStyle}>
                        <option>Yes</option><option>No</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Disease Type</label>
                      <select value={rightEditForm.disease_type} disabled={rightEditForm.disease_detected === 'No'} onChange={(e) => { const val = e.target.value; setRightEditForm(prev => ({ ...prev, disease_type: val, severity: getSeverityOptions(val, prev.disease_detected)[0] })); }} className="w-full px-3 py-2 rounded-xl text-sm outline-none cursor-pointer disabled:opacity-50" style={inputStyle}>
                        <option>Diabetic Retinopathy</option><option>Cataract</option><option>Glaucoma</option><option>N/A</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Severity</label>
                      <select value={rightEditForm.severity} onChange={(e) => setRightEditForm(prev => ({ ...prev, severity: e.target.value }))} className="w-full px-3 py-2 rounded-xl text-sm outline-none cursor-pointer" style={inputStyle}>
                        {getSeverityOptions(rightEditForm.disease_type, rightEditForm.disease_detected).map(opt => <option key={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setRightEditing(false)} className="flex-1 py-2 rounded-xl text-sm font-semibold text-gray-700 cursor-pointer hover:brightness-90 transition-all duration-200" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}>Cancel</button>
                      <button onClick={() => handleEditConfirm('right')} className="flex-1 py-2 rounded-xl text-sm font-bold text-white cursor-pointer hover:brightness-110 transition-all duration-200" style={{ background: '#f97316' }}>Confirm</button>
                    </div>
                  </div>
                </div>
              ) : rightEdited ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-sm font-bold text-gray-900">Right Eye Diagnosis</h4>
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">Doctor Edited</span>
                  </div>
                  <div className="space-y-1 text-sm text-gray-600">
                    <p><span className="font-semibold text-gray-900">Disease Detected:</span> {rightRes?.disease_detected ? 'Yes' : 'No'}</p>
                    <p><span className="font-semibold text-gray-900">Disease Type:</span> {rightRes?.disease_type ?? '-'}</p>
                    <p><span className="font-semibold text-gray-900">Severity:</span> {rightRes?.severity_label ?? '-'}</p>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  {!isLocked && (
                    <button onClick={() => ragResult ? handleEnterEditMode('right') : undefined} disabled={!ragResult} title={!ragResult ? 'Generate Clinical Report Summary first' : undefined} className={`absolute top-0 right-0 text-xs px-3 py-1.5 rounded-lg font-semibold text-white transition-all duration-200 ${ragResult ? 'cursor-pointer hover:scale-[1.05] active:scale-[0.97] hover:brightness-110' : 'cursor-not-allowed opacity-40 grayscale'}`} style={ragResult ? { background: 'linear-gradient(135deg, #dc2626 0%, #ea580c 100%)', boxShadow: '0 4px 14px rgba(220,38,38,0.4)' } : { background: 'linear-gradient(135deg, #dc2626 0%, #ea580c 100%)' }}>Edit</button>
                  )}
                  <EyePanel title="Right Eye Diagnosis" result={rightRes} originalImg={rightImg} showHeatmap={showHeatmap} section="stats" />
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <hr style={{ borderColor: '#e5e7eb', margin: '16px 0' }} />

      {latestReview?.decision === 'overridden' && (
        <>
          <h3 className="text-base font-bold text-gray-900 mb-2">Final Verdict (Doctor Override)</h3>
          <div className="mb-4 px-4 py-3 rounded-xl text-sm text-gray-700" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
            <p className="font-semibold text-orange-600 mb-2">Doctor has overridden the AI verdict.</p>
            <p><span className="font-semibold">Reviewed at:</span> {formatDt((latestReview as unknown as Record<string, unknown>).reviewed_at as string ?? latestReview.created_at)}</p>
            <p><span className="font-semibold">Override reason:</span> {latestReview.override_reason ?? '-'}</p>
            <div className="grid grid-cols-2 gap-4 mt-2">
              <p><span className="font-semibold">Final grade (Left):</span> {latestReview.final_grade_left ?? '-'}</p>
              <p><span className="font-semibold">Final grade (Right):</span> {latestReview.final_grade_right ?? '-'}</p>
            </div>
          </div>
          <hr style={{ borderColor: '#e5e7eb', margin: '16px 0' }} />
        </>
      )}

      {/* Generate button */}
      <div className="flex flex-col items-center mb-6">
        <button onClick={handleRAG} disabled={isLocked || !hasResults || ragLoading} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]" style={{ background: '#7c3aed', boxShadow: '0 8px 28px rgba(124,58,237,0.45)' }}>
          🧠 {ragLoading ? 'Generating…' : 'Generate Clinical Report Summary'}
        </button>
        {!hasResults && <p className="mt-2 text-sm text-gray-500 text-center">AI results are required before generating a summary.</p>}
        {hasResults && !isLocked && !ragResult && <p className="mt-2 text-sm text-gray-500 text-center">Generate this Report Summary to unlock Approve and Override (edit) options.</p>}
      </div>

      {ragLoading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4 text-sm" style={{ background: '#faf5ff', border: '1px solid #e9d5ff', color: '#7c3aed' }}>
          <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin shrink-0" />
          Consulting knowledge base & generating clinical summary…
        </div>
      )}

      {ragResult && (
        <div className="bg-white rounded-xl border-l-4 mb-6" style={{ borderLeftColor: '#2563eb', padding: '28px 32px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
          <div className="flex items-center gap-2 mb-5">
            <span className="text-xl">📋</span>
            <h4 className="text-base font-semibold text-gray-800">AI Clinical Summary</h4>
            <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dbeafe', color: '#1d4ed8' }}>Based on Research</span>
            {!isLocked && !isEditingReport && (
              <button onClick={() => setIsEditingReport(true)} className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white transition-all duration-200 cursor-pointer hover:scale-[1.05] active:scale-[0.97] hover:brightness-110" style={{ background: 'linear-gradient(135deg, #dc2626 0%, #ea580c 100%)', boxShadow: '0 4px 14px rgba(220,38,38,0.4)' }}>Edit</button>
            )}
            {isEditingReport && <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#b45309' }}>Editing</span>}
          </div>
          <hr style={{ borderColor: '#e5e7eb', marginBottom: 20 }} />
          {isEditingReport ? (
            <>
              <RagReportEditor key={sessionId} ref={reportEditorRef} initialMarkdown={ragResult.rag_summary} />
              <div className="flex justify-end gap-3 mt-4">
                <button onClick={() => setIsEditingReport(false)} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-700 cursor-pointer hover:brightness-90 transition-all duration-200" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}>Cancel</button>
                <button onClick={() => setShowSaveReportConfirm(true)} className="px-4 py-2 rounded-xl text-sm font-bold text-white cursor-pointer hover:scale-[1.05] active:scale-[0.97] hover:brightness-110 transition-all duration-200" style={{ background: 'linear-gradient(135deg, #dc2626 0%, #ea580c 100%)', boxShadow: '0 4px 14px rgba(220,38,38,0.4)' }}>Confirm</button>
              </div>
            </>
          ) : (
            <div className="prose prose-sm md:prose-base prose-blue max-w-none prose-headings:font-semibold prose-headings:text-gray-800 prose-p:text-gray-600 prose-hr:border-gray-200 prose-hr:my-6 prose-strong:text-gray-800 prose-li:text-gray-600">
              <ReactMarkdown>{ragResult.rag_summary}</ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {!ragResult && !ragLoading && (leftEdited || rightEdited) && (
        <div className="bg-white rounded-xl border-l-4 mb-6" style={{ borderLeftColor: '#f59e0b', padding: '24px 28px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">⚠️</span>
            <h4 className="text-base font-semibold text-gray-800">AI Clinical Summary</h4>
            <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#b45309' }}>Needs Regeneration</span>
          </div>
          <p className="text-sm text-gray-600 mb-4">Clinical summary needs regeneration after the diagnosis edit.</p>
          <button onClick={handleRAG} disabled={ragLoading || isLocked || !hasResults} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-40 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]" style={{ background: '#7c3aed', boxShadow: '0 6px 20px rgba(124,58,237,0.35)' }}>
            🧠 {ragLoading ? 'Regenerating…' : 'Regenerate Clinical Summary'}
          </button>
        </div>
      )}

      {(ragResult !== null || isLocked) && (
        <>
          <hr style={{ borderColor: '#e5e7eb', margin: '16px 0' }} />
          <h3 className="text-lg font-semibold text-gray-900 mt-8 mb-4">Doctor Actions</h3>
          <div className="flex flex-wrap justify-center gap-4 mb-6">
            {(leftEdited || rightEdited) ? (
              <button onClick={handleSubmit} disabled={isLocked || !hasResults || submitting} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-40 cursor-pointer transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]" style={{ boxShadow: '0 8px 24px rgba(249,115,22,0.45)' }}>
                {submitting ? 'Submitting…' : '✍️ Submit'}
              </button>
            ) : (
              <button onClick={handleApprove} disabled={isLocked || !hasResults || submitting} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-green-500 hover:bg-green-600 disabled:opacity-40 cursor-pointer transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]" style={{ boxShadow: '0 8px 24px rgba(34,197,94,0.45)' }}>
                ✅ Approve
              </button>
            )}
            {ragResult && (
              <button onClick={() => { if (!patientEmail) { toast.error('Patient has no email on record.'); return; } setShowSendConfirm(true); }} disabled={sendingReport} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 cursor-pointer transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]" style={{ boxShadow: '0 8px 24px rgba(59,130,246,0.45)' }}>
                <Mail size={15} /> Send Report to Patient
              </button>
            )}
          </div>
        </>
      )}

      {/* Modals */}
      {showSendConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4">
            <div className="flex items-center gap-2 mb-3"><Mail size={18} className="text-blue-600" /><h3 className="text-base font-semibold text-gray-900">Send Report to Patient</h3></div>
            <p className="text-sm text-gray-600 mb-1">This will send the clinical summary to:</p>
            <p className="text-sm font-semibold text-gray-900 mb-5">{patientEmail}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowSendConfirm(false)} disabled={sendingReport} className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 transition-all duration-200 disabled:opacity-50" style={{ background: '#f3f4f6' }}>Cancel</button>
              <button onClick={handleSendReport} disabled={sendingReport} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white cursor-pointer hover:brightness-110 transition-all duration-200 disabled:opacity-60" style={{ background: '#2563eb' }}>{sendingReport ? 'Sending…' : 'Confirm & Send'}</button>
            </div>
          </div>
        </div>
      )}

      {showOverrideConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-sm mx-4 p-6 rounded-2xl bg-white" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div className="flex items-center gap-3 mb-3"><span className="text-2xl">✍️</span><h3 className="text-lg font-bold text-gray-900">Confirm Override</h3></div>
            <p className="text-sm text-gray-500 mb-1">You are about to override the AI result for:</p>
            <p className="text-sm font-bold text-gray-900 mb-4">{pendingConfirmEye === 'left' ? 'Left Eye' : 'Right Eye'}</p>
            <p className="text-xs text-gray-400 mb-5">This will permanently replace the AI result. This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => { setShowOverrideConfirm(false); setPendingConfirmEye(null); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-700 cursor-pointer hover:brightness-90 transition-all duration-200" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}>Cancel</button>
              <button onClick={handleOverrideConfirmed} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white cursor-pointer hover:brightness-110 transition-all duration-200" style={{ background: 'linear-gradient(135deg, #dc2626 0%, #ea580c 100%)', boxShadow: '0 4px 14px rgba(220,38,38,0.4)' }}>Confirm Override</button>
            </div>
          </div>
        </div>
      )}

      {showSaveReportConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-sm mx-4 p-6 rounded-2xl bg-white" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div className="flex items-center gap-3 mb-3"><Pencil size={18} className="text-blue-600" /><h3 className="text-lg font-bold text-gray-900">Save Report Edits?</h3></div>
            <p className="text-sm text-gray-600 mb-5">Your changes will update the clinical summary and save it to the database.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowSaveReportConfirm(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-700 cursor-pointer hover:brightness-90 transition-all duration-200" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}>Cancel</button>
              <button onClick={handleSaveReportEdits} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white cursor-pointer hover:brightness-110 transition-all duration-200" style={{ background: '#2563eb' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Appointment helpers ──────────────────────────────────────────────────────

function apptStatusColor(status: string): string {
  switch (status) {
    case 'scheduled':  return 'bg-blue-100 text-blue-700';
    case 'completed':  return 'bg-green-100 text-green-700';
    case 'cancelled':  return 'bg-red-100 text-red-600';
    case 'no_show':    return 'bg-gray-100 text-gray-500';
    default:           return 'bg-gray-100 text-gray-600';
  }
}

function ApptStatusBadge({ status }: { status: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${apptStatusColor(status)}`}>{status.replace('_', ' ')}</span>;
}

function ApptChip({ appt, onClick, className }: { appt: Appointment; onClick: () => void; className?: string }) {
  const d = new Date(appt.appointment_datetime);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return (
    <button onClick={onClick} className={`w-full min-w-0 overflow-hidden text-left text-xs px-1.5 py-0.5 rounded-md mb-0.5 font-medium cursor-pointer hover:brightness-90 transition-all duration-150 ${apptStatusColor(appt.status)} ${className ?? ''}`}>
      <span className="truncate overflow-hidden block">{h}:{m} {appt.patient_name ?? 'Patient'}</span>
    </button>
  );
}

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const result = new Date(d);
  result.setDate(d.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function apptDate(appt: Appointment): Date { return new Date(appt.appointment_datetime); }

function fmtTime(dt: string): string {
  return new Date(dt).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: true });
}

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ─── Sub-view: Doctor Appointments ───────────────────────────────────────────

function DoctorAppointmentsView({ doctorId }: { doctorId: string }) {
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [calMode, setCalMode] = useState<'week' | 'month' | 'day'>('week');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);

  useEffect(() => {
    setLoading(true);
    appointmentsAPI.getAll({ assigned_doctor_id: doctorId })
      .then(data => setAppts(data))
      .catch(() => toast.error('Failed to load appointments.'))
      .finally(() => setLoading(false));
  }, [doctorId]);

  const renderWeek = () => {
    const weekStart = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const today = new Date();
    const hours = Array.from({ length: 11 }, (_, i) => i + 8);
    return (
      <div className="overflow-x-auto">
        <div style={{ minWidth: 640 }}>
          <div className="flex border-b border-gray-200">
            <div className="w-16 shrink-0" />
            {days.map((d, i) => (
              <div key={i} className={`flex-1 text-center py-2 text-xs font-semibold ${sameDay(d, today) ? 'text-blue-600' : 'text-gray-500'}`}>
                <div>{WEEK_DAYS[i]}</div>
                <div className={`text-base font-bold mt-0.5 ${sameDay(d, today) ? 'bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center mx-auto' : ''}`}>{d.getDate()}</div>
              </div>
            ))}
          </div>
          {hours.map(h => (
            <div key={h} className="flex border-b border-gray-100">
              <div className="w-16 shrink-0 text-xs text-gray-400 py-1 pr-2 text-right leading-6">{String(h).padStart(2, '0')}:00</div>
              {days.map((d, i) => {
                const slotAppts = appts.filter(a => sameDay(apptDate(a), d) && new Date(a.appointment_datetime).getHours() === h);
                return (
                  <div key={i} className="flex-1 overflow-hidden min-w-0 py-0.5 px-0.5 border-l border-gray-100">
                    {slotAppts.map(a => <ApptChip key={a.id} appt={a} onClick={() => setSelectedAppt(a)} />)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMonth = () => {
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1))];
    while (cells.length % 7 !== 0) cells.push(null);
    const today = new Date();
    return (
      <div>
        <div className="grid grid-cols-7 border-b border-gray-200 mb-1">
          {WEEK_DAYS.map(d => <div key={d} className="text-center py-1 text-xs font-semibold text-gray-500">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const dayAppts = d ? appts.filter(a => sameDay(apptDate(a), d)) : [];
            const isToday = d ? sameDay(d, today) : false;
            return (
              <div key={i} className="min-h-[72px] border border-gray-100 p-1">
                {d && (<><div className={`text-xs font-semibold mb-0.5 ${isToday ? 'text-blue-600' : 'text-gray-500'}`}>{d.getDate()}</div>{dayAppts.map(a => <ApptChip key={a.id} appt={a} onClick={() => setSelectedAppt(a)} />)}</>)}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDay = () => {
    const hours = Array.from({ length: 11 }, (_, i) => i + 8);
    const dayAppts = appts.filter(a => sameDay(apptDate(a), anchor));
    const today = new Date();
    return (
      <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
        {hours.map(h => {
          const slotAppts = dayAppts.filter(a => new Date(a.appointment_datetime).getHours() === h);
          return (
            <div key={h} className="flex border-b border-gray-100">
              <div className="w-16 shrink-0 text-xs text-gray-400 py-2 pr-2 text-right">{String(h).padStart(2, '0')}:00</div>
              <div className="flex-1 overflow-hidden min-w-0 py-1 pl-2">{slotAppts.map(a => <ApptChip key={a.id} appt={a} onClick={() => setSelectedAppt(a)} />)}</div>
            </div>
          );
        })}
        {dayAppts.length === 0 && <p className="text-xs text-gray-400 text-center py-8">No appointments on {sameDay(anchor, today) ? 'today' : anchor.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })}.</p>}
      </div>
    );
  };

  const navLabel = () => {
    if (calMode === 'month') return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
    if (calMode === 'day') return anchor.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const ws = startOfWeek(anchor);
    const we = addDays(ws, 6);
    return `${ws.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })} – ${we.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  };

  const navPrev = () => {
    if (calMode === 'week') setAnchor(d => addDays(d, -7));
    else if (calMode === 'month') setAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    else setAnchor(d => addDays(d, -1));
  };
  const navNext = () => {
    if (calMode === 'week') setAnchor(d => addDays(d, 7));
    else if (calMode === 'month') setAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    else setAnchor(d => addDays(d, 1));
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4"><h2 className="text-2xl font-bold text-gray-900">My Schedule</h2></div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <button onClick={navPrev} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 cursor-pointer transition-all duration-200"><ChevronLeft size={16} /></button>
          <button onClick={navNext} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 cursor-pointer transition-all duration-200"><ChevronRight size={16} /></button>
          <span className="text-sm font-semibold text-gray-800 ml-2">{navLabel()}</span>
        </div>
        <div className="flex gap-1">
          {(['month', 'week', 'day'] as const).map(m => (
            <button key={m} onClick={() => setCalMode(m)} className={`px-3 py-1.5 text-xs font-semibold capitalize cursor-pointer hover:brightness-90 transition-all duration-200 ${calMode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`} style={{ border: calMode === m ? '1px solid #2563eb' : '1px solid #e5e7eb' }}>{m}</button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center items-center py-12"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          {calMode === 'week' && renderWeek()}
          {calMode === 'month' && renderMonth()}
          {calMode === 'day' && renderDay()}
        </>
      )}
      {selectedAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-md mx-4 p-6 rounded-2xl" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Appointment Details</h3>
              <button onClick={() => setSelectedAppt(null)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer"><X size={16} /></button>
            </div>
            <div className="space-y-3 mb-5">
              <div><p className="text-xs text-gray-500 mb-0.5">Patient</p><p className="text-sm font-semibold text-gray-900">{selectedAppt.patient_name ?? '—'}</p></div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Date & Time</p>
                <p className="text-sm font-semibold text-gray-900">
                  {new Date(selectedAppt.appointment_datetime).toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  {' at '}{fmtTime(selectedAppt.appointment_datetime)}
                </p>
              </div>
              <div><p className="text-xs text-gray-500 mb-0.5">Status</p><ApptStatusBadge status={selectedAppt.status} /></div>
              {selectedAppt.notes && <div><p className="text-xs text-gray-500 mb-0.5">Notes</p><p className="text-sm text-gray-700">{selectedAppt.notes}</p></div>}
            </div>
            <div className="px-4 py-3 rounded-xl text-xs text-gray-500" style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}>Contact the nurse to make changes to this appointment.</div>
            <button onClick={() => setSelectedAppt(null)} className="mt-4 w-full py-2.5 rounded-xl text-sm font-semibold text-gray-700 cursor-pointer hover:brightness-90 transition-all duration-200" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-view: All Patients (Doctor) ─────────────────────────────────────────

function AllPatientsDoctorView({
  patients,
  patientIcMap,
  sessionCountByPatient,
  onSelectPatient,
}: {
  patients: { patient_id: string; patient_name: string; latest: number }[];
  patientIcMap: Map<string, string>;
  sessionCountByPatient: Map<string, number>;
  onSelectPatient: (patient_id: string, patient_name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const tableRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(p => {
      const ic = patientIcMap.get(p.patient_id)?.toLowerCase() ?? '';
      return p.patient_name.toLowerCase().includes(q) || ic.includes(q);
    });
  }, [patients, patientIcMap, query]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > totalPages) setPage(1);
  }, [filtered.length, page]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">All Patients</h2>
      <p className="text-sm mb-4 text-gray-500">Patients with sessions assigned to you.</p>

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setPage(1); }}
          placeholder="Search patient by name or IC..."
          className="w-full pl-9 pr-3 py-2 rounded-xl text-sm outline-none"
          style={inputStyle}
        />
      </div>

      <hr style={{ borderColor: '#e5e7eb', marginBottom: 12 }} />

      {patients.length === 0 ? (
        <p className="text-sm text-gray-500">No patients yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500">No patients match your search.</p>
      ) : (
        <div ref={tableRef}>
          <p className="text-xs mb-3 text-gray-400">
            {filtered.length > PAGE_SIZE
              ? `Showing ${paginated.length} of ${filtered.length} patient(s).`
              : `Showing ${filtered.length} patient(s).`}
          </p>
          <div className="grid text-xs font-bold uppercase tracking-wide pb-2 mb-1 text-gray-400" style={{ gridTemplateColumns: '2fr 1.5fr 100px', borderBottom: '1px solid #e5e7eb' }}>
            <span>Name</span><span>IC / Passport</span><span className="text-right">Sessions</span>
          </div>
          {paginated.map(p => {
            const ic = patientIcMap.get(p.patient_id) ?? '—';
            const count = sessionCountByPatient.get(p.patient_id) ?? 0;
            return (
              <div key={p.patient_id} className="grid items-center py-3" style={{ gridTemplateColumns: '2fr 1.5fr 100px', borderBottom: '1px solid #f3f4f6' }}>
                <button
                  onClick={() => onSelectPatient(p.patient_id, p.patient_name)}
                  className="text-left text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                >
                  {p.patient_name}
                </button>
                <span className="text-sm text-gray-600">{ic}</span>
                <span className="text-sm text-gray-900 text-right tabular-nums">{count}</span>
              </div>
            );
          })}
          <Pagination
            totalItems={filtered.length}
            itemsPerPage={PAGE_SIZE}
            currentPage={page}
            onPageChange={setPage}
            scrollTargetRef={tableRef}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main: Doctor Dashboard ───────────────────────────────────────────────────

export default function DoctorDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<DoctorView>({ name: 'inbox' });
  const [reviewRefreshKey] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isDragging, setIsDragging] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [assignedSessions, setAssignedSessions] = useState<ScreeningSession[]>([]);
  const [isEditingReport, setIsEditingReport] = useState(false);
  const [showLogoLeaveConfirm, setShowLogoLeaveConfirm] = useState(false);

  const storageKey = `visionary_doctor_cleared_${user?.user_id ?? ''}`;
  const [clearedIds, setClearedIds] = useState<Set<string>>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    if (!user?.user_id) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(clearedIds)));
    } catch { /* ignore quota errors */ }
  }, [clearedIds, user?.user_id, storageKey]);

  useEffect(() => {
    if (!user) return;
    screeningsAPI.getAssignedToDoctor(user.user_id)
      .then(r => setAssignedSessions(r.data ?? []))
      .catch(() => {});
  }, [user, view.name]);

  useEffect(() => {
    if (assignedSessions.length === 0) return;
    const validIds = new Set(assignedSessions.map(s => s.id));
    setClearedIds(prev => {
      const filtered = new Set<string>();
      for (const id of prev) if (validIds.has(id)) filtered.add(id);
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [assignedSessions]);

  const patients = useMemo(() => {
    const map = new Map<string, { patient_id: string; patient_name: string; latest: number }>();
    for (const s of assignedSessions) {
      const enriched = s as unknown as Record<string, unknown>;
      const pid =
        (enriched['patient_id'] as string | undefined) ??
        ((enriched['patients'] as Record<string, unknown> | undefined)?.['id'] as string | undefined);
      const pname = extractPatientName(s) || '(Unknown)';
      const dateStr = (enriched['session_date'] as string | undefined) ?? (enriched['created_at'] as string | undefined);
      const ts = dateStr ? new Date(dateStr).getTime() : 0;
      if (!pid) continue;
      const existing = map.get(pid);
      if (!existing || ts > existing.latest) {
        map.set(pid, { patient_id: pid, patient_name: pname, latest: ts });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.latest - a.latest);
  }, [assignedSessions]);

  const topPatients = useMemo(() => patients.slice(0, 5), [patients]);

  const sessionCountByPatient = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of assignedSessions) {
      const enriched = s as unknown as Record<string, unknown>;
      const pid =
        (enriched['patient_id'] as string | undefined) ??
        ((enriched['patients'] as Record<string, unknown> | undefined)?.['id'] as string | undefined);
      if (!pid) continue;
      counts.set(pid, (counts.get(pid) ?? 0) + 1);
    }
    return counts;
  }, [assignedSessions]);

  const [patientIcMap, setPatientIcMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    patientsAPI.search(undefined, 200)
      .then(r => {
        const m = new Map<string, string>();
        for (const p of (r.data ?? []) as Patient[]) m.set(p.id, p.ic_passport);
        setPatientIcMap(m);
      })
      .catch(() => {});
  }, []);

  const sidebarDisplayPatients = sidebarQuery.trim()
    ? patients.filter(p => p.patient_name.toLowerCase().includes(sidebarQuery.trim().toLowerCase()))
    : topPatients;

  const handleClearSessions = (ids: string[]) => {
    setClearedIds(prev => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  };

  const handleReviewBack = () => {
    if (view.name !== 'review') { setView({ name: 'inbox' }); return; }
    const rt = view.returnTo;
    if (rt.kind === 'patient-history') {
      setView({ name: 'patient-history', patient_id: rt.patient_id, patient_name: rt.patient_name });
    } else {
      setView({ name: 'inbox' });
    }
  };

  const headerBackLabel = '← Back';

  const handleLogoClick = () => {
    if (isEditingReport) {
      setShowLogoLeaveConfirm(true);
      return;
    }
    setView({ name: 'inbox' });
  };

  const handleLogout = () => { logout(); navigate('/login', { replace: true }); };

  const handleSidebarDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    setIsDragging(true);
    const onMouseMove = (ev: MouseEvent) => { setSidebarWidth(Math.min(500, Math.max(200, startWidth + (ev.clientX - startX)))); };
    const onMouseUp = () => { setIsDragging(false); window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#f9fafb', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Sidebar */}
      <div className="flex flex-col shrink-0 h-screen overflow-hidden" style={{ width: isSidebarOpen ? sidebarWidth : 0, minWidth: 0, background: '#fff', borderRight: '1px solid #e5e7eb', transition: isDragging ? 'none' : 'width 300ms ease', position: 'relative' }}>
        {/* User info */}
        <div className="px-4 py-4 shrink-0" style={{ borderBottom: '1px solid #e5e7eb' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}>👤</div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-gray-900 text-sm truncate">{user?.name ?? 'Doctor'}</p>
              <p className="text-xs truncate text-gray-500">{user?.email}</p>
              <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: '#dbeafe', border: '1px solid #93c5fd', color: '#1d4ed8' }}>Doctor</span>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="shrink-0 p-1 rounded-lg text-gray-400 cursor-pointer hover:bg-gray-100 transition-all duration-200" title="Close sidebar"><ChevronLeft size={16} /></button>
          </div>
        </div>

        {/* My Schedule nav */}
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
            <CalendarDays size={15} /> My Schedule
          </button>
        </div>

        {/* Patient search */}
        <div className="px-3 pt-1 pb-1">
          <p className="text-xs font-bold uppercase tracking-widest mb-2 text-gray-400">My Patients</p>
          <div className="relative mb-2">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="w-full pl-7 pr-2 py-1.5 rounded-xl text-xs outline-none" style={inputStyle} placeholder="Search patient..." value={sidebarQuery} onChange={e => setSidebarQuery(e.target.value)} />
          </div>
        </div>

        {/* Patient list */}
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {patients.length === 0 && (
            <p className="text-xs px-1 text-gray-400">No patients yet. Sessions will appear here once nurses assign them to you.</p>
          )}
          {patients.length > 0 && sidebarDisplayPatients.length === 0 && (
            <p className="text-xs px-1 text-gray-400">No patients match your search.</p>
          )}
          {sidebarDisplayPatients.map(p => {
            const isActive = view.name === 'patient-history' && view.patient_id === p.patient_id;
            return (
              <div key={p.patient_id} className="mb-1">
                <button
                  onClick={() => setView({ name: 'patient-history', patient_id: p.patient_id, patient_name: p.patient_name })}
                  className="w-full text-left px-3 py-2 rounded-xl text-sm text-gray-900 cursor-pointer"
                  style={{ background: isActive ? '#dbeafe' : '#f9fafb', color: isActive ? '#1d4ed8' : '#111827', fontWeight: isActive ? 600 : 400 }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f3f4f6'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = '#f9fafb'; }}
                >
                  {p.patient_name}
                </button>
              </div>
            );
          })}
          {patients.length > 0 && (
            <button
              onClick={() => setView({ name: 'all-patients' })}
              className="block w-full text-left px-3 py-2 mt-1 text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
            >
              See more patients →
            </button>
          )}
        </div>

        <hr style={{ borderColor: '#e5e7eb' }} />
        <div className="p-3">
          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-bold cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]" style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#dc2626' }}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>

        <div onMouseDown={handleSidebarDragStart} style={{ position: 'absolute', top: 0, right: 0, width: 6, height: '100%', cursor: 'col-resize', zIndex: 20 }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.25)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <AppHeader
          onLogoClick={handleLogoClick}
          leftSlot={
            <>
              <button onClick={() => setIsSidebarOpen(v => !v)} className="p-1.5 rounded-xl text-gray-500 cursor-pointer hover:bg-gray-100 transition-all duration-200" style={{ background: '#f3f4f6' }} title="Toggle sidebar"><Menu size={16} /></button>
              {view.name === 'review' && (
                <button onClick={handleReviewBack} className="ml-2 text-sm font-bold text-blue-600 cursor-pointer hover:brightness-90 transition-all duration-200">{headerBackLabel}</button>
              )}
              {(view.name === 'patient-history' || view.name === 'appointments' || view.name === 'all-patients') && (
                <button onClick={() => setView({ name: 'inbox' })} className="ml-2 text-sm font-bold text-blue-600 cursor-pointer hover:brightness-90 transition-all duration-200">← Back to Inbox</button>
              )}
            </>
          }
        />
        <main className="flex-1 overflow-y-auto min-w-0">
          {view.name === 'inbox' && user && (
            <InboxView
              user={user}
              clearedIds={clearedIds}
              onClear={handleClearSessions}
              onOpen={s => {
                const patientName = extractPatientName(s);
                setView({ name: 'review', sessionId: s.id, patientName, returnTo: { kind: 'inbox' } });
              }}
            />
          )}
          {view.name === 'patient-history' && user && (
            <PatientHistoryView
              user={user}
              patientId={view.patient_id}
              patientName={view.patient_name}
              onOpen={s => {
                const patientName = extractPatientName(s);
                setView({
                  name: 'review',
                  sessionId: s.id,
                  patientName,
                  returnTo: { kind: 'patient-history', patient_id: view.patient_id, patient_name: view.patient_name },
                });
              }}
            />
          )}
          {view.name === 'review' && user && (
            <ReviewView
              sessionId={view.sessionId}
              patientName={view.patientName}
              onBack={handleReviewBack}
              user={user}
              refreshKey={reviewRefreshKey}
              isEditingReport={isEditingReport}
              setIsEditingReport={setIsEditingReport}
            />
          )}
          {view.name === 'appointments' && user && (
            <DoctorAppointmentsView doctorId={user.user_id} />
          )}
          {view.name === 'all-patients' && user && (
            <AllPatientsDoctorView
              patients={patients}
              patientIcMap={patientIcMap}
              sessionCountByPatient={sessionCountByPatient}
              onSelectPatient={(pid, pname) => setView({ name: 'patient-history', patient_id: pid, patient_name: pname })}
            />
          )}
        </main>
      </div>

      {showLogoLeaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-sm mx-4 p-6 rounded-2xl bg-white" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <h3 className="text-lg font-bold text-gray-900 mb-3">You have unsaved changes</h3>
            <p className="text-sm text-gray-600 mb-5">Your clinical summary edits will be lost if you leave this page. Are you sure?</p>
            <div className="flex gap-3">
              <button onClick={() => setShowLogoLeaveConfirm(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-700 cursor-pointer hover:brightness-90 transition-all duration-200" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}>Cancel</button>
              <button
                onClick={() => {
                  setIsEditingReport(false);
                  setShowLogoLeaveConfirm(false);
                  setView({ name: 'inbox' });
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 cursor-pointer transition-all duration-150 shadow-sm hover:shadow-md"
              >
                Leave anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}