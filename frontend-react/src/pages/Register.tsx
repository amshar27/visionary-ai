import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

const inputStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d1d5db',
  color: '#111827',
};

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [staffId, setStaffId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffId.trim() || !email.trim() || !password.trim()) {
      toast.error('All fields are required.');
      return;
    }
    if (password.trim().length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      await register({
        staff_id: staffId.trim(),
        email: email.trim().toLowerCase(),
        password: password.trim(),
      });
      toast.success('Registration successful. Redirecting to login…');
      setTimeout(() => navigate('/login', { replace: true }), 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center"
      style={{ backgroundColor: '#f9fafb', fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      <div style={{ height: '15vh' }} />

      <div
        className="w-full max-w-[520px] mx-4 px-8 py-10 rounded-2xl"
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}
      >
        <h1 className="text-center text-4xl font-extrabold text-gray-900 mb-1.5">Register</h1>
        <p className="text-center text-sm mb-6 text-gray-500">
          Create your hospital staff account
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Staff ID — e.g. NUR0001"
            value={staffId}
            onChange={e => setStaffId(e.target.value)}
            className="w-full px-4 py-3 rounded-xl text-sm outline-none"
            style={inputStyle}
          />

          <input
            type="email"
            placeholder="e.g. ahmad@hospital.my"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-xl text-sm outline-none"
            style={inputStyle}
          />

          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              placeholder="Minimum 6 characters"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none pr-10"
              style={inputStyle}
            />
            <button
              type="button"
              onClick={() => setShowPw(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 cursor-pointer hover:bg-gray-100 transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl font-bold text-white text-sm transition-opacity disabled:opacity-60 bg-blue-600 hover:bg-blue-700 cursor-pointer"
          >
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="text-center mt-5 text-sm text-gray-700">
          Already have an account?{' '}
          <Link to="/login" className="font-bold ml-1 text-blue-600 cursor-pointer hover:brightness-90 transition-all duration-150">
            Go to Login
          </Link>
        </p>
      </div>
    </div>
  );
}
