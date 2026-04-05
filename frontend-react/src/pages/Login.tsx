import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types';

const ROLE_HOME: Record<UserRole, string> = {
  nurse: '/nurse',
  doctor: '/doctor',
  admin: '/admin',
};

const inputStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d1d5db',
  color: '#111827',
};

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  // Redirect if already logged in (mirrors Streamlit login.py top guard)
  useEffect(() => {
    if (user) navigate(ROLE_HOME[user.role], { replace: true });
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error('Email and password are required.');
      return;
    }
    setLoading(true);
    try {
      const resp = await login({ email: email.trim().toLowerCase(), password });
      navigate(ROLE_HOME[resp.role], { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center"
      style={{ backgroundColor: '#f9fafb', fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      <div style={{ height: '18vh' }} />

      <div
        className="w-full max-w-[520px] mx-4 px-8 py-10 rounded-2xl"
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}
      >
        <h1 className="text-center text-4xl font-extrabold text-gray-900 mb-1.5">Login</h1>
        <p className="text-center text-sm mb-6 text-gray-500">
          Sign in with your hospital email
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="e.g. nurse@hospital.my"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-xl text-sm outline-none"
            style={inputStyle}
          />

          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              placeholder="Your password"
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
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center mt-5 text-sm text-gray-700">
          Don't have an account?{' '}
          <Link to="/register" className="font-bold ml-1 text-blue-600 cursor-pointer hover:brightness-90 transition-all duration-150">
            Register here
          </Link>
        </p>
      </div>
    </div>
  );
}
