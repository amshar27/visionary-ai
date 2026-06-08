import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, LogOut, Shield, Save, KeyRound, Trash2, Users, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { adminAPI } from '../services/api';
import type { StaffUser, Patient } from '../types';
import AppHeader from '../components/AppHeader';
import Pagination from '../components/Pagination';
import { validateName, validatePassword, validateConfirmPassword, validateIcPassport, validatePhone } from '../utils/validation';

const ADMIN_PAGE_SIZE = 10;

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
  padding: '20px 24px',
  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
};

// ─── Confirm modal ──────────────────────────────────────────────────────────────

type ConfirmState = {
  open: boolean;
  message: string;
  danger: boolean;
  confirmLabel: string;
  onConfirm: () => void;
};

const CLOSED_CONFIRM: ConfirmState = { open: false, message: '', danger: false, confirmLabel: 'Confirm', onConfirm: () => {} };

function ConfirmModal({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  if (!state.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(15,23,42,0.45)' }}
      onClick={onClose}
    >
      <div style={{ ...cardStyle, maxWidth: 420, width: '100%' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900 mb-2">Please confirm</h3>
        <p className="text-sm text-gray-600 mb-5">{state.message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 cursor-pointer hover:brightness-95 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}
          >
            Cancel
          </button>
          <button
            onClick={() => { state.onConfirm(); onClose(); }}
            className="px-4 py-2 rounded-xl text-sm font-bold text-white cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={state.danger
              ? { background: '#dc2626', border: '1px solid #b91c1c' }
              : { background: '#2563eb', border: '1px solid #1d4ed8' }}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, [string, string]> = {
    nurse:  ['#dcfce7', '#16a34a'],
    doctor: ['#dbeafe', '#1d4ed8'],
    admin:  ['#fee2e2', '#dc2626'],
  };
  const [bg, color] = map[role?.toLowerCase()] ?? ['#f3f4f6', '#6b7280'];
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: bg, color }}>
      {role ?? '-'}
    </span>
  );
}

// ─── Staff Users Tab ──────────────────────────────────────────────────────────

function StaffUsersTab({ requesterRole }: { requesterRole: string }) {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersPage, setUsersPage] = useState(1);
  const tableRef = useRef<HTMLDivElement | null>(null);

  // Update name form
  const [updateStaffId, setUpdateStaffId] = useState('');
  const [updateName, setUpdateName] = useState('');

  // Reset password form
  const [resetStaffId, setResetStaffId] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  // Delete form
  const [deleteStaffId, setDeleteStaffId] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  // Confirmation modal
  const [confirm, setConfirm] = useState<ConfirmState>(CLOSED_CONFIRM);

  const load = () => {
    setLoading(true);
    adminAPI.getStaffUsers(requesterRole)
      .then(r => {
        const data = r.data ?? [];
        setStaff(data);
        if (data.length > 0) {
          setUpdateStaffId(data[0].staff_id);
          setResetStaffId(data[0].staff_id);
          setDeleteStaffId(data[0].staff_id);
        }
      })
      .catch(() => toast.error('Failed to load staff users.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(staff.length / ADMIN_PAGE_SIZE));
    if (usersPage > totalPages) setUsersPage(1);
  }, [staff.length, usersPage]);

  const paginatedStaff = staff.slice((usersPage - 1) * ADMIN_PAGE_SIZE, usersPage * ADMIN_PAGE_SIZE);
  const staffIds = staff.map(s => s.staff_id);
  const getRow = (sid: string) => staff.find(s => s.staff_id === sid);
  const updateRow = getRow(updateStaffId);
  const resetRow = getRow(resetStaffId);
  const deleteRow = getRow(deleteStaffId);

  // Sync name input when user changes selection
  useEffect(() => {
    if (updateRow) setUpdateName(updateRow.name ?? '');
  }, [updateStaffId]);

  const handleUpdateName = () => {
    const nameErr = validateName(updateName); if (nameErr) { toast.error(nameErr); return; }
    setConfirm({
      open: true,
      danger: false,
      confirmLabel: 'Confirm',
      message: `Update name for ${updateStaffId} (${updateRow?.email ?? '-'}) to "${updateName.trim()}"?`,
      onConfirm: doUpdateName,
    });
  };

  const doUpdateName = async () => {
    try {
      await adminAPI.updateStaffName(updateStaffId, { requester_role: requesterRole, name: updateName.trim() });
      toast.success(`User updated (Staff ID: ${updateStaffId}).`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed.');
    }
  };

  const handleResetPassword = () => {
    const pwErr = validatePassword(newPw); if (pwErr) { toast.error(pwErr); return; }
    const confirmErr = validateConfirmPassword(newPw, confirmPw); if (confirmErr) { toast.error(confirmErr); return; }
    setConfirm({
      open: true,
      danger: false,
      confirmLabel: 'Confirm',
      message: `Reset password for ${resetStaffId} (${resetRow?.email ?? '-'})? The user will need the new password to log in.`,
      onConfirm: doResetPassword,
    });
  };

  const doResetPassword = async () => {
    try {
      await adminAPI.resetStaffPassword(resetStaffId, { requester_role: requesterRole, new_password: newPw.trim() });
      toast.success(`Password reset (Staff ID: ${resetStaffId}).`);
      setNewPw(''); setConfirmPw('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Password reset failed.');
    }
  };

  const handleDelete = () => {
    setConfirm({
      open: true,
      danger: true,
      confirmLabel: 'Delete User',
      message: `Permanently delete the login account for ${deleteStaffId} (${deleteRow?.email ?? '-'})? This cannot be undone.`,
      onConfirm: doDelete,
    });
  };

  const doDelete = async () => {
    try {
      await adminAPI.deleteStaffUser(deleteStaffId, { requester_role: requesterRole });
      toast.success(`User deleted (Staff ID: ${deleteStaffId}).`);
      setConfirmDel(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (staff.length === 0) return <p className="text-sm text-gray-500">No staff users found.</p>;

  const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', borderBottom: '1px solid #e5e7eb' };
  const tdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 13, color: '#374151', borderBottom: '1px solid #f3f4f6' };

  return (
    <div className="space-y-6">
      {/* Table */}
      <div ref={tableRef} style={cardStyle}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">System Users</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full">
            <thead>
              <tr>
                {['Staff ID', 'Name', 'Email', 'Role', 'Created'].map(h => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {paginatedStaff.map(s => (
                <tr key={s.id}>
                  <td style={tdStyle}><code className="text-xs text-blue-600">{s.staff_id}</code></td>
                  <td style={tdStyle}>{s.name ?? '-'}</td>
                  <td style={tdStyle}>{s.email}</td>
                  <td style={tdStyle}><RoleBadge role={s.role} /></td>
                  <td style={{ ...tdStyle, fontSize: 11, color: '#9ca3af' }}>{s.created_at ? new Date(s.created_at).toLocaleDateString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          totalItems={staff.length}
          itemsPerPage={ADMIN_PAGE_SIZE}
          currentPage={usersPage}
          onPageChange={setUsersPage}
          scrollTargetRef={tableRef}
        />
      </div>

      {/* Update name */}
      <div style={cardStyle}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">✏️ Update User Name (by Staff ID)</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs mb-1 block text-gray-500">Staff ID</label>
            <select className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-3 cursor-pointer" style={inputStyle} value={updateStaffId} onChange={e => setUpdateStaffId(e.target.value)}>
              {staffIds.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
            <label className="text-xs mb-1 block text-gray-500">Name</label>
            <input className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} value={updateName} onChange={e => setUpdateName(e.target.value)} />
          </div>
          <div className="text-sm text-gray-600">
            {updateRow && (
              <>
                <p className="mb-1">Email: <span className="text-gray-900">{updateRow.email}</span></p>
                <p>Role: <RoleBadge role={updateRow.role} /></p>
              </>
            )}
          </div>
        </div>
        <button onClick={handleUpdateName} className="mt-3 flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]">
          <Save size={14} /> Save Name Changes
        </button>
      </div>

      {/* Reset password */}
      <div style={cardStyle}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">🔐 Reset User Password (by Staff ID)</h3>
        <select className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-2 cursor-pointer" style={inputStyle} value={resetStaffId} onChange={e => setResetStaffId(e.target.value)}>
          {staffIds.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
        {resetRow && (
          <p className="text-xs mb-3 text-gray-500">
            Target: <strong className="text-gray-900">{resetRow.name}</strong> · {resetRow.email} · <RoleBadge role={resetRow.role} />
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs mb-1 block text-gray-500">New Password</label>
            <input type="password" className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} value={newPw} onChange={e => setNewPw(e.target.value)} />
          </div>
          <div>
            <label className="text-xs mb-1 block text-gray-500">Confirm New Password</label>
            <input type="password" className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
          </div>
        </div>
        <button onClick={handleResetPassword} className="mt-3 flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]">
          <KeyRound size={14} /> Reset Password
        </button>
      </div>

      {/* Delete */}
      <div style={cardStyle}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">🗑️ Delete User Account (by Staff ID)</h3>
        <select className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-2 cursor-pointer" style={inputStyle} value={deleteStaffId} onChange={e => { setDeleteStaffId(e.target.value); setConfirmDel(false); }}>
          {staffIds.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
        {deleteRow && (
          <>
            <div className="mb-3 px-3 py-2 rounded-xl text-xs text-gray-700" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
              This deletes the user's <strong>login account</strong> from staff_users. The employee registry entry is not affected.
              After deletion, the staff cannot log in until the account is registered again.
            </div>
            <p className="text-xs mb-2 text-gray-500">
              Target: <strong className="text-gray-900">{deleteRow.name}</strong> · {deleteRow.email} · <RoleBadge role={deleteRow.role} />
            </p>
          </>
        )}
        <label className="flex items-center gap-2 cursor-pointer mb-3 text-sm text-gray-700">
          <input type="checkbox" checked={confirmDel} onChange={e => setConfirmDel(e.target.checked)} />
          I understand this will permanently delete login account for {deleteStaffId}.
        </label>
        <button
          onClick={handleDelete}
          disabled={!confirmDel}
          className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold disabled:opacity-40 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#dc2626' }}
        >
          <Trash2 size={14} /> Delete User
        </button>
      </div>

      <ConfirmModal state={confirm} onClose={() => setConfirm(CLOSED_CONFIRM)} />
    </div>
  );
}

// ─── Patients Tab ─────────────────────────────────────────────────────────────

function PatientsTab({ requesterRole }: { requesterRole: string }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [patientsPage, setPatientsPage] = useState(1);
  const tableRef = useRef<HTMLDivElement | null>(null);

  // Update form
  const [updateIc, setUpdateIc] = useState('');
  const [updateName, setUpdateName] = useState('');
  const [updateIcVal, setUpdateIcVal] = useState('');
  const [updateContact, setUpdateContact] = useState('');

  // Delete form
  const [deleteIc, setDeleteIc] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  // Confirmation modal
  const [confirm, setConfirm] = useState<ConfirmState>(CLOSED_CONFIRM);

  const load = () => {
    setLoading(true);
    adminAPI.getPatients(requesterRole)
      .then(r => {
        const data = r.data ?? [];
        setPatients(data);
        if (data.length > 0) {
          setUpdateIc(data[0].ic_passport);
          setDeleteIc(data[0].ic_passport);
        }
      })
      .catch(() => toast.error('Failed to load patients.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(patients.length / ADMIN_PAGE_SIZE));
    if (patientsPage > totalPages) setPatientsPage(1);
  }, [patients.length, patientsPage]);

  const paginatedPatients = patients.slice((patientsPage - 1) * ADMIN_PAGE_SIZE, patientsPage * ADMIN_PAGE_SIZE);
  const icList = patients.map(p => p.ic_passport);
  const getPatient = (ic: string) => patients.find(p => p.ic_passport === ic);
  const updatePatient = getPatient(updateIc);
  const deletePatient = getPatient(deleteIc);

  // Sync form fields when IC changes
  useEffect(() => {
    if (updatePatient) {
      setUpdateName(updatePatient.name ?? '');
      setUpdateIcVal(updatePatient.ic_passport ?? '');
      setUpdateContact(updatePatient.contact_number ?? '');
    }
  }, [updateIc]);

  const handleUpdate = () => {
    const nameErr = validateName(updateName); if (nameErr) { toast.error(nameErr); return; }
    const icErr = validateIcPassport(updateIcVal); if (icErr) { toast.error(icErr); return; }
    const phoneErr = validatePhone(updateContact); if (phoneErr) { toast.error(phoneErr); return; }
    setConfirm({
      open: true,
      danger: false,
      confirmLabel: 'Confirm',
      message: `Save changes to patient ${updateName.trim()} (IC: ${updateIcVal.trim()})?`,
      onConfirm: doUpdate,
    });
  };

  const doUpdate = async () => {
    try {
      await adminAPI.updatePatientByIC(updateIc, {
        requester_role: requesterRole,
        name: updateName.trim(),
        ic_passport: updateIcVal.trim(),
        contact_number: updateContact.trim(),
      });
      toast.success(`Patient updated (IC: ${updateIc} → ${updateIcVal.trim()}).`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed.');
    }
  };

  const handleDelete = () => {
    setConfirm({
      open: true,
      danger: true,
      confirmLabel: 'Delete Patient',
      message: `Permanently delete patient ${deletePatient?.name ?? '-'} (IC: ${deleteIc})? This may affect related screening sessions and history.`,
      onConfirm: doDelete,
    });
  };

  const doDelete = async () => {
    try {
      await adminAPI.deletePatientByIC(deleteIc, { requester_role: requesterRole });
      toast.success(`Patient deleted (IC: ${deleteIc}).`);
      setConfirmDel(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (patients.length === 0) return <p className="text-sm text-gray-500">No patients found.</p>;

  const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', borderBottom: '1px solid #e5e7eb' };
  const tdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 13, color: '#374151', borderBottom: '1px solid #f3f4f6' };

  return (
    <div className="space-y-6">
      {/* Table */}
      <div ref={tableRef} style={cardStyle}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">All Patients</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full">
            <thead>
              <tr>
                {['Name', 'IC/Passport', 'Age', 'Sex', 'Contact', 'Diabetes', 'Created'].map(h => <th key={h} style={thStyle}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {paginatedPatients.map(p => (
                <tr key={p.id}>
                  <td style={tdStyle}>{p.name}</td>
                  <td style={tdStyle}><code className="text-xs text-blue-600">{p.ic_passport}</code></td>
                  <td style={tdStyle}>{p.age ?? '-'}</td>
                  <td style={tdStyle}>{p.sex ?? '-'}</td>
                  <td style={tdStyle}>{p.contact_number ?? '-'}</td>
                  <td style={tdStyle}>{String(p.diabetes_known)}</td>
                  <td style={{ ...tdStyle, fontSize: 11, color: '#9ca3af' }}>{p.created_at ? new Date(p.created_at).toLocaleDateString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          totalItems={patients.length}
          itemsPerPage={ADMIN_PAGE_SIZE}
          currentPage={patientsPage}
          onPageChange={setPatientsPage}
          scrollTargetRef={tableRef}
        />
      </div>

      {/* Update patient */}
      <div style={cardStyle}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">✏️ Update Patient (by IC/Passport)</h3>
        <label className="text-xs mb-1 block text-gray-500">Patient IC/Passport</label>
        <select className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-3 cursor-pointer" style={inputStyle} value={updateIc} onChange={e => setUpdateIc(e.target.value)}>
          {icList.map(ic => {
            const p = getPatient(ic);
            return <option key={ic} value={ic}>{ic}{p ? ` — ${p.name}` : ''}</option>;
          })}
        </select>

        {updatePatient && (
          <>
            <div className="grid grid-cols-2 gap-4 mb-1">
              <div>
                <label className="text-xs mb-1 block text-gray-500">Name</label>
                <input className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-2 cursor-pointer" style={inputStyle} value={updateName} onChange={e => setUpdateName(e.target.value)} />
                <label className="text-xs mb-1 block text-gray-500">IC / Passport</label>
                <input className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={inputStyle} value={updateIcVal} onChange={e => setUpdateIcVal(e.target.value)} />
              </div>
              <div>
                <label className="text-xs mb-1 block text-gray-500">Contact Number</label>
                <input className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-2 cursor-pointer" style={inputStyle} value={updateContact} onChange={e => setUpdateContact(e.target.value)} />
                <label className="text-xs mb-1 block text-gray-400">Sex (read-only)</label>
                <input className="w-full px-3 py-2.5 rounded-xl text-sm outline-none opacity-50" style={inputStyle} value={updatePatient.sex ?? ''} disabled />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3 text-xs text-gray-400">
              <span>Age: {updatePatient.age ?? '-'}</span>
              <span>Diabetes: {String(updatePatient.diabetes_known)}</span>
              <span>Type: {updatePatient.diabetes_type ?? '-'}</span>
            </div>
          </>
        )}

        <button onClick={handleUpdate} className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]">
          <Save size={14} /> Save Patient Changes
        </button>
      </div>

      {/* Delete patient */}
      <div style={cardStyle}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">🗑️ Delete Patient (by IC/Passport)</h3>
        <select className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-2 cursor-pointer" style={inputStyle} value={deleteIc} onChange={e => { setDeleteIc(e.target.value); setConfirmDel(false); }}>
          {icList.map(ic => {
            const p = getPatient(ic);
            return <option key={ic} value={ic}>{ic}{p ? ` — ${p.name}` : ''}</option>;
          })}
        </select>

        {deletePatient && (
          <div className="mb-3 px-3 py-2 rounded-xl text-xs text-gray-700" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
            Deleting a patient may affect related screening sessions and history.
            <br />Target: <strong className="text-gray-900">{deletePatient.name}</strong> · IC: {deleteIc}
          </div>
        )}

        <label className="flex items-center gap-2 cursor-pointer mb-3 text-sm text-gray-700">
          <input type="checkbox" checked={confirmDel} onChange={e => setConfirmDel(e.target.checked)} />
          I understand this will permanently delete patient record: {deleteIc}.
        </label>
        <button
          onClick={handleDelete}
          disabled={!confirmDel}
          className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold disabled:opacity-40 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#dc2626' }}
        >
          <Trash2 size={14} /> Delete Patient
        </button>
      </div>

      <ConfirmModal state={confirm} onClose={() => setConfirm(CLOSED_CONFIRM)} />
    </div>
  );
}

// ─── Main: Admin Dashboard ────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'users' | 'patients'>('users');

  const handleLogout = () => { logout(); navigate('/login', { replace: true }); };

  const handleLogoClick = () => { setTab('users'); };

  return (
    <div className="min-h-screen" style={{ background: '#f9fafb', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <AppHeader
        onLogoClick={handleLogoClick}
        leftSlot={<Shield size={18} style={{ color: '#dc2626' }} />}
        rightSlot={
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{user?.name ?? user?.email}</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#dc2626' }}
            >
              <LogOut size={12} /> Sign Out
            </button>
          </div>
        }
      />

      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>Admin Dashboard</h1>
            <p className="text-sm mt-0.5 text-gray-500" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.13)' }}>Manage system users (accounts) and patients.</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-600 cursor-pointer hover:brightness-110 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-md"
            style={{ background: '#f3f4f6', border: '1px solid #e5e7eb' }}
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', display: 'inline-flex' }}>
          {(['users', 'patients'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 cursor-pointer hover:brightness-90 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: tab === t ? '#3b82f6' : 'transparent',
                color: tab === t ? '#fff' : '#6b7280',
              }}
            >
              {t === 'users' ? <><Users size={14} /> Manage System Users</> : <><UserRound size={14} /> Manage Patients</>}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'users' && <StaffUsersTab requesterRole={user?.role ?? 'admin'} />}
        {tab === 'patients' && <PatientsTab requesterRole={user?.role ?? 'admin'} />}
      </div>
    </div>
  );
}
