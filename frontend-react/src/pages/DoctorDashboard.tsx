import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, LogOut, Search, Menu, ChevronLeft, CalendarDays, X, ChevronRight, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../context/AuthContext';
import { screeningsAPI, uploadsAPI, aiAPI, appointmentsAPI } from '../services/api';
import { formatDt, getEyeSide, fmtConfidence } from '../utils/format';
import type { ScreeningSession, RetinalImage, AIResult, DoctorReview, RAGSummaryResponse, Appointment } from '../types';
import type { User } from '../types';

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
  borderRadius: 14,
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
              <p><span className="font-semibold text-gray-900">Disease Type:</span> {result.disease_type ?? 'Not specified'}</p>
              <p><span className="font-semibold text-gray-900">Severity:</span> {result.severity_label ?? result.dr_severity ?? 'Not specified'}</p>
              <p><span className="font-semibold text-gray-900">Referable:</span> {String(result.referable)}</p>
              <p><span className="font-semibold text-gray-900">Confidence:</span> {fmtConfidence(result.confidence_score)}</p>
              <p><span className="font-semibold text-gray-900">Follow-up:</span> {result.follow_up_interval ?? '-'}</p>
              {result.llm_summary && (
                <div className="mt-2 p-2 rounded-lg text-xs shadow-md" style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
                  <p className="font-semibold text-gray-900 mb-1">LLM Summary:</p>
                  <p className="text-gray-600">{result.llm_summary}</p>
                </div>
              )}
              {result.warnings?.length > 0 && (
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

type DoctorView =
  | { name: 'inbox' }
  | { name: 'review'; sessionId: string; patientName: string }
  | { name: 'appointments' };

// ─── Sub-view: Doctor Inbox ───────────────────────────────────────────────────

function InboxView({
  user,
  onOpen,
}: {
  user: User;
  onOpen: (s: ScreeningSession) => void;
}) {
  const [sessions, setSessions] = useState<ScreeningSession[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    screeningsAPI.getAssignedToDoctor(user.user_id)
      .then(r => setSessions(r.data ?? []))
      .catch(() => toast.error('Could not load inbox.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [user.user_id]);

  const filtered = statusFilter === 'all'
    ? sessions
    : sessions.filter(s => s.status === statusFilter);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-bold text-gray-900">Doctor Inbox</h2>
        <button onClick={load} className="p-2 rounded-xl text-gray-500 cursor-pointer hover:bg-gray-100 transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]" style={{ background: '#f3f4f6' }}>
          <RefreshCw size={14} />
        </button>
      </div>
      <p className="text-sm mb-4 text-gray-500">These are screening sessions assigned to you.</p>

      {/* Filter */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status:</span>
        {['all', 'assigned', 'pending', 'approved', 'overridden'].map(opt => (
          <button
            key={opt}
            onClick={() => setStatusFilter(opt)}
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
        <>
          <p className="text-xs mb-3 text-gray-400">Showing {filtered.length} session(s).</p>
          {/* Table header */}
          <div className="grid text-xs font-bold uppercase tracking-wide pb-2 mb-1 text-gray-400" style={{ gridTemplateColumns: '60px 1fr 1fr 1fr 100px 90px', borderBottom: '1px solid #e5e7eb' }}>
            <span>No.</span><span>Date</span><span>Patient</span><span>Assigned By</span><span>Status</span><span>Action</span>
          </div>
          {filtered.map(s => {
            const raw = s as unknown as Record<string, unknown>;
            const sessionNo = raw.session_number as number ?? '-';
            const sessionDate = raw.session_date as string ?? s.created_at;
            const patientName = raw.patient_name as string ?? s.patient?.name ?? 'Unknown';
            const assignedBy = raw.assigned_by_name as string ?? '-';
            const isFinalized = ['approved', 'overridden'].includes(s.status?.toLowerCase());
            return (
              <div key={s.id} className="grid items-center py-3" style={{ gridTemplateColumns: '60px 1fr 1fr 1fr 100px 90px', borderBottom: '1px solid #f3f4f6' }}>
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
          <p className="text-xs mt-3 text-gray-400">Tip: Approved/overridden sessions open in read-only mode.</p>
        </>
      )}
    </div>
  );
}

// ─── Sub-view: Doctor Review ──────────────────────────────────────────────────

const DR_GRADES = ['', 'No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative', 'Ungradable'];

function ReviewView({
  sessionId,
  patientName: _patientName,
  onBack,
  user,
  refreshKey,
}: {
  sessionId: string;
  patientName: string;
  onBack: () => void;
  user: User;
  refreshKey?: number;
}) {
  const [session, setSession] = useState<ScreeningSession | null>(null);
  const [images, setImages] = useState<RetinalImage[]>([]);
  const [aiResults, setAiResults] = useState<AIResult[]>([]);
  const [latestReview, setLatestReview] = useState<DoctorReview | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(true); // default true for doctor (matches Streamlit)
  const [ragResult, setRagResult] = useState<RAGSummaryResponse | null>(null);
  const [ragLoading, setRagLoading] = useState(false);

  // Send report state
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);

  // Override modal state
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [finalLeft, setFinalLeft] = useState('');
  const [finalRight, setFinalRight] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      console.log('[ReviewView] session.patient:', (sResp.data as unknown as Record<string, unknown>)?.patients);
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

  useEffect(() => { load(); }, [sessionId, refreshKey]);

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

  const handleOverride = async () => {
    if (!overrideReason.trim()) {
      toast.error('Override reason is required.');
      return;
    }
    setSubmitting(true);
    try {
      await screeningsAPI.submitReview(sessionId, {
        doctor_id: user.user_id,
        decision: 'overridden',
        override_reason: overrideReason.trim(),
        final_grade_left: finalLeft || undefined,
        final_grade_right: finalRight || undefined,
      });
      toast.success('Overridden. Session is now locked.');
      onBack();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Override failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRAG = async () => {
    setRagLoading(true);
    try {
      const result = await aiAPI.summariseRAG(sessionId);
      setRagResult(result);
      toast.success('Clinical summary generated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate summary.');
    } finally {
      setRagLoading(false);
    }
  };

  const handleSendReport = async () => {
    if (!ragResult) return;
    const email = patientEmail;
    if (!email) return;
    setSendingReport(true);
    try {
      const pName = (session as unknown as Record<string, unknown>)?.patient_name as string ?? session?.patient?.name ?? 'Patient';
      await screeningsAPI.sendReport(sessionId, {
        patient_email: email,
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
  const patientName = raw?.patient_name as string ?? session?.patient?.name ?? 'Unknown patient';
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

      {/* Retinal images (view only) */}
      <h3 className="text-base font-bold text-gray-900 mb-3">Retinal Images (View Only)</h3>
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
                  No image for this session
                </div>
              )}
            </div>
          );
        })}
      </div>

      <hr style={{ borderColor: '#e5e7eb', margin: '16px 0' }} />

      {/* AI Verdict */}
      <h3 className="text-base font-bold text-gray-900 mb-1">AI Verdict</h3>
      {!hasResults && (
        <p className="text-sm mb-4" style={{ color: '#ea580c' }}>No AI results found for this session yet.</p>
      )}
      {hasResults && (
        <>
          <p className="text-xs mb-3 text-gray-500">
            Toggle the switch to view Grad-CAM heatmap or original image for both eyes.
          </p>
          {/* Images only */}
          <div className="grid grid-cols-2 gap-4 mb-2">
            <div style={elevatedCardStyle}><EyePanel title="Left Eye Diagnosis" result={leftRes} originalImg={leftImg} showHeatmap={showHeatmap} section="image" /></div>
            <div style={elevatedCardStyle}><EyePanel title="Right Eye Diagnosis" result={rightRes} originalImg={rightImg} showHeatmap={showHeatmap} section="image" /></div>
          </div>
          {/* Heatmap toggle — right-aligned, below images, above DR stats */}
          <div className="flex justify-end mb-3">
            <HeatmapToggle value={showHeatmap} onChange={setShowHeatmap} />
          </div>
          {/* Stats only */}
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div style={elevatedCardStyle}><EyePanel title="Left Eye Diagnosis" result={leftRes} originalImg={leftImg} showHeatmap={showHeatmap} section="stats" /></div>
            <div style={elevatedCardStyle}><EyePanel title="Right Eye Diagnosis" result={rightRes} originalImg={rightImg} showHeatmap={showHeatmap} section="stats" /></div>
          </div>
        </>
      )}

      <hr style={{ borderColor: '#e5e7eb', margin: '16px 0' }} />

      {/* Doctor Override display (if overridden) */}
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

      {/* 1. Generate button — always visible, centred */}
      <div className="flex flex-col items-center mb-6">
        <button
          onClick={handleRAG}
          disabled={isLocked || !hasResults || ragLoading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: '#7c3aed', boxShadow: '0 8px 28px rgba(124,58,237,0.45)' }}
        >
          🧠 {ragLoading ? 'Generating…' : 'Generate Clinical Research Summary'}
        </button>
        {!hasResults && (
          <p className="mt-2 text-sm text-gray-500 text-center">AI results are required before generating a summary.</p>
        )}
        {hasResults && !isLocked && !ragResult && (
          <p className="mt-2 text-sm text-gray-500 text-center">Generate summary to unlock Approve and Override options.</p>
        )}
      </div>

      {/* 2. RAG loading indicator */}
      {ragLoading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4 text-sm" style={{ background: '#faf5ff', border: '1px solid #e9d5ff', color: '#7c3aed' }}>
          <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin shrink-0" />
          Consulting knowledge base & generating clinical summary…
        </div>
      )}

      {/* 3. Summary box — appears directly below the button once generated */}
      {ragResult && (
        <div
          className="bg-white rounded-xl border-l-4 mb-6"
          style={{ borderLeftColor: '#2563eb', padding: '28px 32px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 mb-5">
            <span className="text-xl">📋</span>
            <h4 className="text-base font-semibold text-gray-800">AI Clinical Summary</h4>
            <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#dbeafe', color: '#1d4ed8' }}>
              Based on Research
            </span>
          </div>

          <hr style={{ borderColor: '#e5e7eb', marginBottom: 20 }} />

          {/* Markdown body */}
          <div className="prose prose-sm md:prose-base prose-blue max-w-none prose-headings:font-semibold prose-headings:text-gray-800 prose-p:text-gray-600 prose-hr:border-gray-200 prose-hr:my-6 prose-strong:text-gray-800 prose-li:text-gray-600">
            <ReactMarkdown>{ragResult.rag_summary}</ReactMarkdown>
          </div>

        </div>
      )}

      {/* 4. Doctor Actions — only rendered after summary exists (or session already finalized) */}
      {(ragResult !== null || isLocked) && (
        <>
          <hr style={{ borderColor: '#e5e7eb', margin: '16px 0' }} />
          <h3 className="text-lg font-semibold text-gray-900 mt-8 mb-4">Doctor Actions</h3>
          <div className="flex flex-wrap justify-center gap-4 mb-6">
            <button
              onClick={handleApprove}
              disabled={isLocked || !hasResults || submitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-green-500 hover:bg-green-600 disabled:opacity-40 cursor-pointer transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
              style={{ boxShadow: '0 8px 24px rgba(34,197,94,0.45)' }}
            >
              ✅ Approve
            </button>
            <button
              onClick={() => setShowOverride(true)}
              disabled={isLocked || !hasResults}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-40 cursor-pointer transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
              style={{ boxShadow: '0 8px 24px rgba(249,115,22,0.45)' }}
            >
              ✍️ Override / Edit
            </button>
            {ragResult && (
              <button
                onClick={() => {
                  if (!patientEmail) {
                    toast.error('Patient has no email on record.');
                    return;
                  }
                  setShowSendConfirm(true);
                }}
                disabled={sendingReport}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 cursor-pointer transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
                style={{ boxShadow: '0 8px 24px rgba(59,130,246,0.45)' }}
              >
                <Mail size={15} />
                Send Report to Patient
              </button>
            )}
          </div>
        </>
      )}

      {/* Send Report Confirmation Modal */}
      {showSendConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4">
            <div className="flex items-center gap-2 mb-3">
              <Mail size={18} className="text-blue-600" />
              <h3 className="text-base font-semibold text-gray-900">Send Report to Patient</h3>
            </div>
            <p className="text-sm text-gray-600 mb-1">This will send the clinical summary to:</p>
            <p className="text-sm font-semibold text-gray-900 mb-5">{patientEmail}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowSendConfirm(false)}
                disabled={sendingReport}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                style={{ background: '#f3f4f6' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSendReport}
                disabled={sendingReport}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
                style={{ background: '#2563eb' }}
              >
                {sendingReport ? 'Sending…' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Override Modal */}
      {showOverride && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-lg mx-4 p-6 rounded-2xl" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Override / Edit Decision</h3>
            <p className="text-xs mb-4" style={{ color: '#ea580c' }}>
              Override will lock the session as 'overridden'. Reason is required.
            </p>

            <label className="text-xs mb-1 block text-gray-500">Override reason (required)</label>
            <textarea
              rows={3}
              placeholder="Explain why you're overriding the AI result…"
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none mb-4"
              style={inputStyle}
            />

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs mb-1 block text-gray-500">Final Grade (Left Eye) — optional</label>
                <select className="w-full px-3 py-2.5 rounded-xl text-sm outline-none cursor-pointer" style={inputStyle} value={finalLeft} onChange={e => setFinalLeft(e.target.value)}>
                  {DR_GRADES.map(g => <option key={g} value={g}>{g || 'Select grade'}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block text-gray-500">Final Grade (Right Eye) — optional</label>
                <select className="w-full px-3 py-2.5 rounded-xl text-sm outline-none cursor-pointer" style={inputStyle} value={finalRight} onChange={e => setFinalRight(e.target.value)}>
                  {DR_GRADES.map(g => <option key={g} value={g}>{g || 'Select grade'}</option>)}
                </select>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleOverride}
                disabled={submitting}
                className="flex-1 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-60 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: '#f97316' }}
              >
                {submitting ? 'Submitting…' : '✍️ Confirm Override'}
              </button>
              <button
                onClick={() => setShowOverride(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-700 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}
              >
                Cancel
              </button>
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
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${apptStatusColor(status)}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function ApptChip({ appt, onClick, className }: { appt: Appointment; onClick: () => void; className?: string }) {
  const d = new Date(appt.appointment_datetime);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return (
    <button
      onClick={onClick}
      className={`w-full min-w-0 overflow-hidden text-left text-xs px-1.5 py-0.5 rounded-md mb-0.5 font-medium cursor-pointer hover:brightness-90 transition-all duration-150 ${apptStatusColor(appt.status)} ${className ?? ''}`}
    >
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
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function apptDate(appt: Appointment): Date {
  return new Date(appt.appointment_datetime);
}

function fmtTime(dt: string): string {
  return new Date(dt).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: true });
}

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ─── Sub-view: Doctor Appointments (read-only) ────────────────────────────────

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

  // ── Week calendar ──
  const renderWeek = () => {
    const weekStart = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const today = new Date();
    const hours = Array.from({ length: 11 }, (_, i) => i + 8); // 08–18

    return (
      <div className="overflow-x-auto">
        <div style={{ minWidth: 640 }}>
          {/* Header row: blank time cell + 7 day headers */}
          <div className="flex border-b border-gray-200">
            <div className="w-16 shrink-0" />
            {days.map((d, i) => (
              <div key={i} className={`flex-1 text-center py-2 text-xs font-semibold ${sameDay(d, today) ? 'text-blue-600' : 'text-gray-500'}`}>
                <div>{WEEK_DAYS[i]}</div>
                <div className={`text-base font-bold mt-0.5 ${sameDay(d, today) ? 'bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center mx-auto' : ''}`}>
                  {d.getDate()}
                </div>
              </div>
            ))}
          </div>
          {/* Time rows */}
          {hours.map(h => (
            <div key={h} className="flex border-b border-gray-100">
              <div className="w-16 shrink-0 text-xs text-gray-400 py-1 pr-2 text-right leading-6">
                {String(h).padStart(2, '0')}:00
              </div>
              {days.map((d, i) => {
                const slotAppts = appts.filter(a => sameDay(apptDate(a), d) && new Date(a.appointment_datetime).getHours() === h);
                return (
                  <div key={i} className="flex-1 overflow-hidden min-w-0 py-0.5 px-0.5 border-l border-gray-100">
                    {slotAppts.map(a => (
                      <ApptChip key={a.id} appt={a} onClick={() => setSelectedAppt(a)} />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── Month calendar ──
  const renderMonth = () => {
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [
      ...Array(offset).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const today = new Date();

    return (
      <div>
        <div className="grid grid-cols-7 border-b border-gray-200 mb-1">
          {WEEK_DAYS.map(d => (
            <div key={d} className="text-center py-1 text-xs font-semibold text-gray-500">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const dayAppts = d ? appts.filter(a => sameDay(apptDate(a), d)) : [];
            const isToday = d ? sameDay(d, today) : false;
            return (
              <div key={i} className="min-h-[72px] border border-gray-100 p-1">
                {d && (
                  <>
                    <div className={`text-xs font-semibold mb-0.5 ${isToday ? 'text-blue-600' : 'text-gray-500'}`}>{d.getDate()}</div>
                    {dayAppts.map(a => (
                      <ApptChip key={a.id} appt={a} onClick={() => setSelectedAppt(a)} />
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Day view ──
  const renderDay = () => {
    const hours = Array.from({ length: 11 }, (_, i) => i + 8); // 08–18
    const dayAppts = appts.filter(a => sameDay(apptDate(a), anchor));
    const today = new Date();

    return (
      <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
        {hours.map(h => {
          const slotAppts = dayAppts.filter(a => new Date(a.appointment_datetime).getHours() === h);
          return (
            <div key={h} className="flex border-b border-gray-100">
              <div className="w-16 shrink-0 text-xs text-gray-400 py-2 pr-2 text-right">
                {String(h).padStart(2, '0')}:00
              </div>
              <div className="flex-1 overflow-hidden min-w-0 py-1 pl-2">
                {slotAppts.map(a => (
                  <ApptChip key={a.id} appt={a} onClick={() => setSelectedAppt(a)} />
                ))}
              </div>
            </div>
          );
        })}
        {dayAppts.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8">No appointments on {sameDay(anchor, today) ? 'today' : anchor.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' })}.</p>
        )}
      </div>
    );
  };

  // ── Navigation labels ──
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
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-900">My Schedule</h2>
      </div>

      {/* Calendar toolbar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <button onClick={navPrev} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 cursor-pointer transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"><ChevronLeft size={16} /></button>
          <button onClick={navNext} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 cursor-pointer transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"><ChevronRight size={16} /></button>
          <span className="text-sm font-semibold text-gray-800 ml-2">{navLabel()}</span>
        </div>
        <div className="flex gap-1">
          {(['month', 'week', 'day'] as const).map(m => (
            <button
              key={m}
              onClick={() => setCalMode(m)}
              className={`px-3 py-1.5 text-xs font-semibold capitalize cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${calMode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}
              style={{ border: calMode === m ? '1px solid #2563eb' : '1px solid #e5e7eb' }}
            >{m}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {calMode === 'week' && renderWeek()}
          {calMode === 'month' && renderMonth()}
          {calMode === 'day' && renderDay()}
        </>
      )}

      {/* Read-only detail modal */}
      {selectedAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-md mx-4 p-6 rounded-2xl" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Appointment Details</h3>
              <button onClick={() => setSelectedAppt(null)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 cursor-pointer transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"><X size={16} /></button>
            </div>

            <div className="space-y-3 mb-5">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Patient</p>
                <p className="text-sm font-semibold text-gray-900">{selectedAppt.patient_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Date & Time</p>
                <p className="text-sm font-semibold text-gray-900">
                  {new Date(selectedAppt.appointment_datetime).toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  {' at '}{fmtTime(selectedAppt.appointment_datetime)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Status</p>
                <ApptStatusBadge status={selectedAppt.status} />
              </div>
              {selectedAppt.notes && (
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Notes</p>
                  <p className="text-sm text-gray-700">{selectedAppt.notes}</p>
                </div>
              )}
            </div>

            <div className="px-4 py-3 rounded-xl text-xs text-gray-500" style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}>
              Contact the nurse to make changes to this appointment.
            </div>

            <button
              onClick={() => setSelectedAppt(null)}
              className="mt-4 w-full py-2.5 rounded-xl text-sm font-semibold text-gray-700 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}
            >
              Close
            </button>
          </div>
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
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isDragging, setIsDragging] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [assignedSessions, setAssignedSessions] = useState<ScreeningSession[]>([]);

  useEffect(() => {
    if (!user) return;
    screeningsAPI.getAssignedToDoctor(user.user_id)
      .then(r => setAssignedSessions(r.data ?? []))
      .catch(() => {});
  }, [user, view.name]); // Reload sidebar when navigating back to inbox

  const filtered = sidebarQuery
    ? assignedSessions.filter(s => {
        const name = ((s as unknown as Record<string, unknown>).patient_name as string ?? s.patient?.name ?? '').toLowerCase();
        return name.includes(sidebarQuery.toLowerCase()) || s.status.includes(sidebarQuery.toLowerCase());
      })
    : assignedSessions;

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
      {/* Sidebar */}
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
        <div className="px-4 py-4 shrink-0" style={{ borderBottom: '1px solid #e5e7eb' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}>👤</div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-gray-900 text-sm truncate">{user?.name ?? 'Doctor'}</p>
              <p className="text-xs truncate text-gray-500">{user?.email}</p>
              <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: '#dbeafe', border: '1px solid #93c5fd', color: '#1d4ed8' }}>Doctor</span>
            </div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="shrink-0 p-1 rounded-lg text-gray-400 cursor-pointer hover:bg-gray-100 transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
              title="Close sidebar"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>

        {/* My Schedule nav */}
        <div className="px-3 pt-3 pb-1">
          <button
            onClick={() => setView({ name: 'appointments' })}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all duration-200 mb-2 cursor-pointer hover:brightness-110 hover:scale-[1.02] active:scale-[0.98] ${view.name === 'appointments' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            <CalendarDays size={15} className="shrink-0" />
            My Schedule
          </button>
        </div>

        {/* Assigned sessions search */}
        <div className="px-3 pt-1 pb-1">
          <p className="text-xs font-bold uppercase tracking-widest mb-2 text-gray-400">Assigned Sessions</p>
          <div className="relative mb-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-7 pr-2 py-1.5 rounded-xl text-xs outline-none"
              style={inputStyle}
              placeholder="Search patient…"
              value={sidebarQuery}
              onChange={e => setSidebarQuery(e.target.value)}
            />
          </div>
          <p className="text-xs mb-2 text-gray-400">Quick open any case</p>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {filtered.map(s => {
            const raw = s as unknown as Record<string, unknown>;
            const patientName = raw.patient_name as string ?? s.patient?.name ?? 'Unknown';
            const sessionNo = raw.session_number as number ?? '-';
            const isFinalized = ['approved', 'overridden'].includes(s.status?.toLowerCase());
            return (
              <div key={s.id} className="mb-1">
                <button
                  onClick={() => setView({ name: 'review', sessionId: s.id, patientName })}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs transition-all duration-200 cursor-pointer hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
                  style={{ background: '#f9fafb', color: isFinalized ? '#6b7280' : '#111827' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#f9fafb')}
                >
                  {patientName} — Session #{String(sessionNo)}
                  {isFinalized && <span className="ml-1.5 text-gray-400">(view)</span>}
                </button>
                <p className="text-xs px-3 text-gray-400">Status: {s.status}</p>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-xs px-1 text-gray-400">No assigned sessions found.</p>
          )}
        </div>

        <hr style={{ borderColor: '#e5e7eb' }} />

        {/* Sign out */}
        <div className="p-3">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-bold cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
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

      {/* Right-side wrapper: header + scrollable content column */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top bar */}
        <header
          className="flex-none flex items-center px-3 py-2 border-b border-gray-200"
          style={{ background: '#fff' }}
        >
          <button
            onClick={() => setIsSidebarOpen(v => !v)}
            className="p-1.5 rounded-xl text-gray-500 cursor-pointer hover:bg-gray-100 transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: '#f3f4f6' }}
            title="Toggle sidebar"
          >
            <Menu size={16} />
          </button>
          {(view.name === 'review' || view.name === 'appointments') && (
            <>
              <button
                onClick={() => setView({ name: 'inbox' })}
                className="ml-3 text-sm text-blue-600 cursor-pointer hover:brightness-90 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              >
                ← Back to Inbox
              </button>
              <button
                onClick={() => setReviewRefreshKey(k => k + 1)}
                className="p-1.5 rounded-lg text-gray-500 cursor-pointer hover:bg-gray-100 transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: '#f3f4f6' }}
                title="Refresh"
              >
                <RefreshCw size={13} />
              </button>
            </>
          )}
        </header>
        <main className="flex-1 overflow-y-auto min-w-0">
        {view.name === 'inbox' && user && (
          <InboxView
            user={user}
            onOpen={s => {
              const patientName = (s as unknown as Record<string, unknown>).patient_name as string ?? s.patient?.name ?? 'Unknown';
              setView({ name: 'review', sessionId: s.id, patientName });
            }}
          />
        )}
        {view.name === 'review' && user && (
          <ReviewView
            sessionId={view.sessionId}
            patientName={view.patientName}
            onBack={() => setView({ name: 'inbox' })}
            user={user}
            refreshKey={reviewRefreshKey}
          />
        )}
        {view.name === 'appointments' && user && (
          <DoctorAppointmentsView doctorId={user.user_id} />
        )}
        </main>
      </div>
    </div>
  );
}
