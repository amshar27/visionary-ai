import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { authAPI } from '../services/api';

type Step = 1 | 2 | 3 | 4;

export default function ForgotPassword() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const [stepVisible, setStepVisible] = useState(true);
  const [resendCountdown, setResendCountdown] = useState(0);

  const otpRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  // Mount animation
  useEffect(() => {
    setTimeout(() => setVisible(true), 50);
  }, []);

  // Resend countdown
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown((c) => c - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  // Enter key support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || loading) return;
      if (step === 1) handleSendOtp();
      if (step === 2) handleVerifyOtp();
      if (step === 3) handleResetPassword();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, loading, email, otp, newPassword, confirmPassword]);

  // Redirect to login after success
  useEffect(() => {
    if (step === 4) {
      const timer = setTimeout(() => navigate('/login'), 2000);
      return () => clearTimeout(timer);
    }
  }, [step, navigate]);

  const changeStep = useCallback((newStep: Step) => {
    setStepVisible(false);
    setTimeout(() => {
      setStep(newStep);
      setError('');
      setStepVisible(true);
    }, 200);
  }, []);

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleSendOtp = async () => {
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authAPI.forgotPassword(email.trim().toLowerCase());
      setResendCountdown(60);
      changeStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCountdown > 0) return;
    setLoading(true);
    setError('');
    try {
      await authAPI.forgotPassword(email.trim().toLowerCase());
      setResendCountdown(60);
      setOtp(['', '', '', '', '', '']);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const code = otp.join('');
    if (code.length !== 6) {
      setError('Please enter the full 6-digit code.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authAPI.verifyOtp(email.trim().toLowerCase(), code);
      changeStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authAPI.resetPassword(email.trim().toLowerCase(), newPassword);
      changeStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  // ─── OTP input handlers ──────────────────────────────────────────────────────

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) {
      // Handle paste
      const digits = value.replace(/\D/g, '').slice(0, 6).split('');
      const newOtp = ['', '', '', '', '', ''];
      digits.forEach((d, i) => {
        if (i < 6) newOtp[i] = d;
      });
      setOtp(newOtp);
      const nextIndex = Math.min(digits.length, 5);
      otpRefs[nextIndex]?.current?.focus();
      return;
    }
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value && index < 5) otpRefs[index + 1]?.current?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs[index - 1]?.current?.focus();
    }
  };

  // ─── Progress dots ───────────────────────────────────────────────────────────

  const dots = (
    <div className="flex justify-center gap-2 mb-6">
      {[1, 2, 3].map((s) => (
        <div
          key={s}
          className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
            step >= s ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        />
      ))}
    </div>
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen flex flex-col items-center"
      style={{ backgroundColor: '#f9fafb', fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      <div style={{ height: '18vh' }} />

      {/* Card */}
      <div
        className="w-full max-w-md mx-4 rounded-2xl p-8"
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(24px)',
          transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <h1 className="text-center text-4xl font-extrabold text-gray-900 mb-1.5">Reset Password</h1>
        <p className="text-center text-sm mb-6 text-gray-500">
          Recover access to your account
        </p>

        {step < 4 && dots}

        {/* Step content with animation */}
        <div
          style={{
            opacity: stepVisible ? 1 : 0,
            transform: stepVisible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'all 0.25s ease',
          }}
        >
          {/* ─── Step 1: Email ─────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm text-gray-600">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm"
                  placeholder="e.g. nurse@hospital.my"
                />
                <p className="text-sm text-gray-500 text-left">
                  Enter your email and we'll send you a verification code.
                </p>
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <button
                onClick={handleSendOtp}
                disabled={loading}
                className="w-full bg-blue-600 text-white font-semibold py-3 px-6 rounded-xl cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_8px_25px_rgba(59,130,246,0.5)] active:translate-y-0 active:shadow-none active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                {loading ? 'Sending...' : 'Send Verification Code'}
              </button>
            </div>
          )}

          {/* ─── Step 2: OTP ──────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="text-center mb-2">
                <p className="text-sm text-gray-500">
                  We sent a 6-digit code to <span className="text-blue-600 font-medium">{email}</span>
                </p>
              </div>

              <div className="flex justify-center gap-2">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={otpRefs[i]}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-12 h-14 text-center text-xl font-bold bg-white border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                ))}
              </div>

              <div className="text-center">
                {resendCountdown > 0 ? (
                  <span className="text-gray-400 text-sm">Resend in {resendCountdown}s</span>
                ) : (
                  <button
                    onClick={handleResendOtp}
                    disabled={loading}
                    className="text-blue-600 hover:text-blue-700 cursor-pointer transition-colors duration-200 text-sm font-medium"
                  >
                    Resend code
                  </button>
                )}
              </div>

              {error && <p className="text-red-500 text-sm text-center">{error}</p>}

              <button
                onClick={handleVerifyOtp}
                disabled={loading}
                className="w-full bg-blue-600 text-white font-semibold py-3 px-6 rounded-xl cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_8px_25px_rgba(59,130,246,0.5)] active:translate-y-0 active:shadow-none active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                {loading ? 'Verifying...' : 'Verify Code'}
              </button>
            </div>
          )}

          {/* ─── Step 3: New Password ─────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="text-center mb-2">
                <p className="text-sm text-gray-500">Choose a strong password for your account.</p>
              </div>

              <div className="space-y-1">
                <label className="text-sm text-gray-600">New Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 pr-10 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm"
                    placeholder="Enter new password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm text-gray-600">Confirm Password</label>
                <div className="relative">
                  <input
                    type={showConfirmPw ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleResetPassword()}
                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 pr-10 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-sm"
                    placeholder="Confirm new password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPw((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
                  >
                    {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <button
                onClick={handleResetPassword}
                disabled={loading}
                className="w-full bg-blue-600 text-white font-semibold py-3 px-6 rounded-xl cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_8px_25px_rgba(59,130,246,0.5)] active:translate-y-0 active:shadow-none active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>
            </div>
          )}

          {/* ─── Step 4: Success ──────────────────────────────────────── */}
          {step === 4 && (
            <div className="text-center space-y-4 py-4">
              <div className="w-16 h-16 rounded-full bg-green-50 border-2 border-green-500 flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Password reset successfully!</h2>
              <p className="text-sm text-gray-500">Redirecting to login...</p>
            </div>
          )}
        </div>

        {/* Back to login */}
        {step < 4 && (
          <p className="text-center mt-5 text-sm text-gray-700">
            <button
              onClick={() => navigate('/login')}
              className="font-bold text-blue-600 hover:text-blue-700 cursor-pointer transition-colors duration-200"
            >
              &larr; Back to login
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
