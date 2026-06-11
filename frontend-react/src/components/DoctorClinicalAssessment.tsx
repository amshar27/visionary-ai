import type { AIResult } from '../types';

export type PrescriptionRow = { drug: string; dose: string; frequency: string; duration: string };

export type EyeExam = {
  visual_acuity: string; slit_lamp: string; iop: string;
  gonioscopy: string; cup_disc: string; visual_field: string;   // glaucoma
  dilated_fundus: string; macular_edema: string;                // DR
  lens_opacity_type: string; lens_density: string; glare_contrast: string; // cataract
};

export type McData = { enabled: boolean; days: string; date_from: string; date_to: string; reason: string };

export type AssessmentData = {
  left: EyeExam; right: EyeExam; other_findings: string;
  clinical_impression: string;
  prescription: PrescriptionRow[]; mc: McData;
};

const emptyEye: EyeExam = { visual_acuity:'', slit_lamp:'', iop:'', gonioscopy:'', cup_disc:'', visual_field:'', dilated_fundus:'', macular_edema:'', lens_opacity_type:'', lens_density:'', glare_contrast:'' };

export const initialAssessmentData: AssessmentData = {
  left: { ...emptyEye }, right: { ...emptyEye }, other_findings: '',
  clinical_impression: '', prescription: [],
  mc: { enabled:false, days:'', date_from:'', date_to:'', reason:'' },
};

export type Condition = 'Glaucoma' | 'Cataract' | 'DR' | 'None' | null;

// MUST mirror the resolver at DoctorDashboard.tsx line ~138: prefer disease_type, else map dr_severity.
export function resolveCondition(result: AIResult | null): Condition {
  if (!result) return null;
  const dt = result.disease_type?.toLowerCase();
  if (dt) {
    if (dt.includes('glaucoma')) return 'Glaucoma';
    if (dt.includes('cataract')) return 'Cataract';
    if (dt.includes('retinopathy') || dt === 'dr') return 'DR';
    if (dt.includes('no disease') || dt === 'none' || dt === 'n/a') return 'None';
  }
  const sev = result.dr_severity?.toLowerCase();
  if (sev === 'glaucoma') return 'Glaucoma';
  if (sev === 'cataract') return 'Cataract';
  if (sev === 'none') return 'None';
  if (['mild','moderate','severe','proliferative'].includes(sev ?? '')) return 'DR';
  return null;
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = { background: '#fff', border: '1px solid #d1d5db', color: '#111827' };

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 14,
  padding: '24px 28px',
  boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
};

const inputCls = 'w-full px-3 py-2 rounded-xl text-sm outline-none';
const labelCls = 'text-xs font-semibold text-gray-500 block mb-1';

// Required-field marker. Mirrors (does NOT drive) the lenient approve gate.
const Req = () => <span className="text-red-500 ml-0.5">*</span>;

// ─── Read-only line helper ────────────────────────────────────────────────────

function ROLine({ label, value }: { label: string; value?: string }) {
  if (!value || !String(value).trim()) return null;
  return (
    <p className="text-sm text-gray-600"><span className="font-semibold text-gray-900">{label}:</span> {value}</p>
  );
}

// ─── Read-only per-eye exam summary ───────────────────────────────────────────

function ReadOnlyEye({ title, exam, condition }: { title: string; exam: EyeExam; condition: Condition }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px' }}>
      <h4 className="text-sm font-bold text-gray-900 mb-2">{title}</h4>
      <div className="space-y-1">
        <ROLine label="Visual Acuity" value={exam.visual_acuity} />
        <ROLine label="Slit-Lamp" value={exam.slit_lamp} />
        <ROLine label="IOP (mmHg)" value={exam.iop} />
        {condition === 'Glaucoma' && (
          <>
            <ROLine label="Gonioscopy" value={exam.gonioscopy} />
            <ROLine label="Cup-to-Disc" value={exam.cup_disc} />
            <ROLine label="Visual Field" value={exam.visual_field} />
          </>
        )}
        {condition === 'DR' && (
          <>
            <ROLine label="Dilated Fundus" value={exam.dilated_fundus} />
            <ROLine label="Macular Edema" value={exam.macular_edema} />
          </>
        )}
        {condition === 'Cataract' && (
          <>
            <ROLine label="Lens Opacity Type" value={exam.lens_opacity_type} />
            <ROLine label="Lens Density" value={exam.lens_density} />
            <ROLine label="Glare/Contrast" value={exam.glare_contrast} />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Editable per-eye exam column ─────────────────────────────────────────────

function EyeColumn({ title, exam, condition, onChange, needVA, needIOP }: {
  title: string;
  exam: EyeExam;
  condition: Condition;
  onChange: (p: Partial<EyeExam>) => void;
  needVA: boolean;
  needIOP: boolean;
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px' }}>
      <h4 className="text-sm font-bold text-gray-900 mb-3">{title}</h4>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Visual Acuity{needVA && <Req />}</label>
          <input value={exam.visual_acuity} onChange={e => onChange({ visual_acuity: e.target.value })} placeholder="e.g. 6/6" className={inputCls} style={inputStyle} />
        </div>
        <div>
          <label className={labelCls}>Slit-Lamp</label>
          <textarea value={exam.slit_lamp} onChange={e => onChange({ slit_lamp: e.target.value })} rows={2} className={inputCls} style={inputStyle} />
        </div>
        <div>
          <label className={labelCls}>IOP (mmHg){needIOP && <Req />}</label>
          <input type="number" value={exam.iop} onChange={e => onChange({ iop: e.target.value })} className={inputCls} style={inputStyle} />
        </div>

        {condition === 'Glaucoma' && (
          <>
            <div>
              <label className={labelCls}>Gonioscopy</label>
              <select value={exam.gonioscopy} onChange={e => onChange({ gonioscopy: e.target.value })} className={`${inputCls} cursor-pointer`} style={inputStyle}>
                <option value="">—</option><option value="open">open</option><option value="narrow">narrow</option><option value="closed">closed</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Cup-to-Disc ratio</label>
              <input value={exam.cup_disc} onChange={e => onChange({ cup_disc: e.target.value })} placeholder="e.g. 0.6" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls}>Visual Field</label>
              <input value={exam.visual_field} onChange={e => onChange({ visual_field: e.target.value })} className={inputCls} style={inputStyle} />
            </div>
          </>
        )}

        {condition === 'DR' && (
          <>
            <div>
              <label className={labelCls}>Dilated Fundus findings</label>
              <textarea value={exam.dilated_fundus} onChange={e => onChange({ dilated_fundus: e.target.value })} rows={2} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls}>Macular Edema</label>
              <select value={exam.macular_edema} onChange={e => onChange({ macular_edema: e.target.value })} className={`${inputCls} cursor-pointer`} style={inputStyle}>
                <option value="">—</option><option value="present">present</option><option value="absent">absent</option>
              </select>
            </div>
          </>
        )}

        {condition === 'Cataract' && (
          <>
            <div>
              <label className={labelCls}>Lens Opacity type</label>
              <select value={exam.lens_opacity_type} onChange={e => onChange({ lens_opacity_type: e.target.value })} className={`${inputCls} cursor-pointer`} style={inputStyle}>
                <option value="">—</option><option value="nuclear">nuclear</option><option value="cortical">cortical</option><option value="subcapsular">subcapsular</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Lens density</label>
              <input value={exam.lens_density} onChange={e => onChange({ lens_density: e.target.value })} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className={labelCls}>Glare/Contrast</label>
              <input value={exam.glare_contrast} onChange={e => onChange({ glare_contrast: e.target.value })} className={inputCls} style={inputStyle} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function DoctorClinicalAssessment({ value, onChange, leftCondition, rightCondition, enabled, readOnly, mcReadOnly }: {
  value: AssessmentData;
  onChange: (next: AssessmentData) => void;
  leftCondition: Condition;
  rightCondition: Condition;
  enabled: boolean;       // interactive (RAG exists & not locked)
  readOnly: boolean;      // locked session -> show saved values, no inputs
  mcReadOnly?: { mc_number?: number|string; days?: number; date_from?: string; date_to?: string; reason?: string } | null;
}) {
  const update = (p: Partial<AssessmentData>) => onChange({ ...value, ...p });
  const updateEye = (eye: 'left' | 'right', p: Partial<EyeExam>) => onChange({ ...value, [eye]: { ...value[eye], ...p } });

  const updatePrescription = (idx: number, p: Partial<PrescriptionRow>) =>
    update({ prescription: value.prescription.map((row, i) => i === idx ? { ...row, ...p } : row) });
  const addPrescription = () =>
    update({ prescription: [...value.prescription, { drug: '', dose: '', frequency: '', duration: '' }] });
  const removePrescription = (idx: number) =>
    update({ prescription: value.prescription.filter((_, i) => i !== idx) });

  const Heading = ({ children }: { children: React.ReactNode }) => (
    <h4 className="text-sm font-bold text-gray-900 mb-3 mt-6 first:mt-0">{children}</h4>
  );

  // ── READ-ONLY MODE ──
  if (readOnly) {
    const hasPrescription = value.prescription.some(r => r.drug || r.dose || r.frequency || r.duration);
    return (
      <div style={cardStyle} className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">🩺</span>
          <h3 className="text-base font-bold text-gray-900">Doctor's Clinical Assessment</h3>
        </div>

        <Heading>Physical Examination</Heading>
        <div className="grid grid-cols-2 gap-4">
          <ReadOnlyEye title="Left Eye" exam={value.left} condition={leftCondition} />
          <ReadOnlyEye title="Right Eye" exam={value.right} condition={rightCondition} />
        </div>
        <div className="mt-3"><ROLine label="Other findings" value={value.other_findings} /></div>

        {value.clinical_impression.trim() && (<><Heading>Clinical Impression</Heading><p className="text-sm text-gray-600 whitespace-pre-wrap">{value.clinical_impression}</p></>)}

        {hasPrescription && (
          <>
            <Heading>Prescription</Heading>
            <div className="space-y-1">
              {value.prescription.filter(r => r.drug || r.dose || r.frequency || r.duration).map((r, i) => (
                <p key={i} className="text-sm text-gray-600">{[r.drug, r.dose, r.frequency, r.duration].filter(Boolean).join(' · ')}</p>
              ))}
            </div>
          </>
        )}

        {mcReadOnly && (
          <>
            <Heading>Medical Certificate</Heading>
            <div className="space-y-1">
              {mcReadOnly.mc_number != null && <ROLine label="Certificate No." value={String(mcReadOnly.mc_number).padStart(5, '0')} />}
              {mcReadOnly.days != null && <ROLine label="Days" value={String(mcReadOnly.days)} />}
              <ROLine label="From" value={mcReadOnly.date_from} />
              <ROLine label="To" value={mcReadOnly.date_to} />
              <ROLine label="Reason" value={mcReadOnly.reason} />
            </div>
          </>
        )}
      </div>
    );
  }

  // ── INTERACTIVE / GREYED MODE ──
  const greyed = !enabled;

  // Required-field affordances — mirror (do NOT drive) the lenient approve gate.
  const needVA = [leftCondition, rightCondition].some(c => c === 'DR' || c === 'Cataract');
  const needIOP = [leftCondition, rightCondition].some(c => c === 'Glaucoma');
  const measureParts: string[] = [];
  if (needVA) measureParts.push('Visual Acuity');
  if (needIOP) measureParts.push('IOP');
  const measure = measureParts.length ? `enter ${measureParts.join(' and ')} for at least one eye, plus ` : '';
  const requiredHint = `Required to approve: ${measure}a Clinical Impression.`;

  return (
    <div style={cardStyle} className="mb-6 relative">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">🩺</span>
        <h3 className="text-base font-bold text-gray-900">Doctor's Clinical Assessment</h3>
      </div>

      <div className={greyed ? 'opacity-40 grayscale pointer-events-none select-none' : ''}>
        {/* SECTION 1 — Physical Examination */}
        <Heading>1. Physical Examination</Heading>
        {enabled && <p className="text-sm text-gray-500 mb-3 -mt-2">{requiredHint}</p>}
        <div className="grid grid-cols-2 gap-4">
          <EyeColumn title="Left Eye" exam={value.left} condition={leftCondition} onChange={p => updateEye('left', p)} needVA={needVA} needIOP={needIOP} />
          <EyeColumn title="Right Eye" exam={value.right} condition={rightCondition} onChange={p => updateEye('right', p)} needVA={needVA} needIOP={needIOP} />
        </div>
        <div className="mt-4">
          <label className={labelCls}>Other findings</label>
          <textarea value={value.other_findings} onChange={e => update({ other_findings: e.target.value })} rows={2} className={inputCls} style={inputStyle} />
        </div>

        {/* SECTION 2 — Clinical Impression */}
        <Heading>2. Clinical Impression<Req /></Heading>
        <textarea value={value.clinical_impression} onChange={e => update({ clinical_impression: e.target.value })} rows={3} className={inputCls} style={inputStyle} />
        <p className="text-xs text-gray-400 mt-1">Documentation only — to change the diagnosis, use the per-eye Edit above.</p>

        {/* SECTION 3 — Prescription */}
        <Heading>3. Prescription</Heading>
        {value.prescription.length === 0 && <p className="text-sm text-gray-400 mb-2">No medications added.</p>}
        <div className="space-y-2">
          {value.prescription.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={row.drug} onChange={e => updatePrescription(i, { drug: e.target.value })} placeholder="Drug" className={`${inputCls} flex-1`} style={inputStyle} />
              <input value={row.dose} onChange={e => updatePrescription(i, { dose: e.target.value })} placeholder="Dose" className={`${inputCls} flex-1`} style={inputStyle} />
              <input value={row.frequency} onChange={e => updatePrescription(i, { frequency: e.target.value })} placeholder="Frequency" className={`${inputCls} flex-1`} style={inputStyle} />
              <input value={row.duration} onChange={e => updatePrescription(i, { duration: e.target.value })} placeholder="Duration" className={`${inputCls} flex-1`} style={inputStyle} />
              <button onClick={() => removePrescription(i)} title="Remove" className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer transition-all duration-150 shrink-0">✕</button>
            </div>
          ))}
        </div>
        <button onClick={addPrescription} className="mt-2 text-sm font-semibold text-blue-600 hover:text-blue-700 cursor-pointer">+ Add medication</button>

        {/* SECTION 4 — Medical Certificate */}
        <Heading>4. Medical Certificate</Heading>
        <label className="flex items-center gap-2 cursor-pointer select-none mb-3">
          <span className="text-sm font-semibold text-gray-700">Issue MC?</span>
          <div
            onClick={() => update({ mc: { ...value.mc, enabled: !value.mc.enabled } })}
            className="w-10 h-5 rounded-full relative transition-colors"
            style={{ background: value.mc.enabled ? '#3b82f6' : '#d1d5db' }}
          >
            <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: value.mc.enabled ? 22 : 2 }} />
          </div>
        </label>
        {value.mc.enabled && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Days<Req /></label>
                <input type="number" value={value.mc.days} onChange={e => update({ mc: { ...value.mc, days: e.target.value } })} className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className={labelCls}>From date<Req /></label>
                <input type="date" value={value.mc.date_from} onChange={e => update({ mc: { ...value.mc, date_from: e.target.value } })} className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className={labelCls}>To date<Req /></label>
                <input type="date" value={value.mc.date_to} onChange={e => update({ mc: { ...value.mc, date_to: e.target.value } })} className={inputCls} style={inputStyle} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Reason<Req /></label>
              <textarea value={value.mc.reason} onChange={e => update({ mc: { ...value.mc, reason: e.target.value } })} rows={2} className={inputCls} style={inputStyle} />
            </div>
          </div>
        )}
      </div>

      {greyed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="px-4 py-2 rounded-xl text-sm font-bold text-white shadow-lg" style={{ background: 'rgba(124,58,237,0.95)' }}>
            Generate Clinical Report Summary first
          </span>
        </div>
      )}
    </div>
  );
}

export default DoctorClinicalAssessment;
