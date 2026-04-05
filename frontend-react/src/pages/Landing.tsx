import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLE_HOME = { nurse: '/nurse', doctor: '/doctor', admin: '/admin' } as const;

export default function Landing() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Mirror app.py: if logged_in, redirect to role dashboard immediately
  useEffect(() => {
    if (user) navigate(ROLE_HOME[user.role], { replace: true });
  }, [user, navigate]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center text-center px-6 relative overflow-hidden"
      style={{ backgroundColor: '#f9fafb', fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* Subtle radial glow */}
      <div
        className="pointer-events-none absolute"
        style={{
          top: '-10%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 900,
          height: 600,
          background:
            'radial-gradient(ellipse at center, rgba(59,130,246,0.07) 0%, rgba(249,250,251,0) 70%)',
        }}
      />
      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 max-w-2xl w-full">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 mb-8 px-4 py-1.5 rounded-full text-xs font-semibold tracking-widest uppercase text-blue-600"
          style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          AI-Powered &nbsp;·&nbsp; Clinical Grade
        </div>

        {/* Hero title */}
        <h1
          className="font-bold text-gray-900 leading-tight mb-5"
          style={{ fontSize: 'clamp(2.4rem, 5vw, 3.8rem)', letterSpacing: '-0.03em' }}
        >
          Retinal Screening,
          <br />
          <span
            style={{
              background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Reimagined with AI
          </span>
        </h1>

        {/* Divider */}
        <div
          className="mx-auto mb-8 rounded-sm"
          style={{
            width: 48,
            height: 2,
            background: 'linear-gradient(90deg, #3b82f6, transparent)',
          }}
        />

        {/* Subtitle */}
        <p
          className="mx-auto mb-10 leading-relaxed text-gray-500"
          style={{ fontSize: 16.5, maxWidth: 520 }}
        >
          Visionary AI brings fast, accurate eye disease screening — detecting
          <br />
          Diabetic Retinopathy, Glaucoma, and Cataract — to your clinical team.
        </p>

        {/* CTA */}
        <button
          onClick={() => navigate('/login')}
          className="px-12 py-3.5 rounded-xl font-semibold text-white text-sm bg-blue-600 hover:bg-blue-700 transition-all duration-200 cursor-pointer hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
          style={{ boxShadow: '0 4px 16px rgba(59,130,246,0.3)' }}
        >
          Get Started →
        </button>

        {/* Trust note */}
        <p
          className="mt-8 tracking-wider text-gray-400"
          style={{ fontSize: 12 }}
        >
          AI-assisted screening &nbsp;·&nbsp; Nurse-to-doctor workflow &nbsp;·&nbsp; Session traceability
        </p>
      </div>
    </div>
  );
}
