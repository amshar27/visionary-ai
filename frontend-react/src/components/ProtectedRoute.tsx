import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
}

/** Maps each role to its home route (mirrors Streamlit session redirects) */
const ROLE_HOME: Record<UserRole, string> = {
  nurse: '/nurse',
  doctor: '/doctor',
  admin: '/admin',
};

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, loading } = useAuth();

  // Still reading localStorage — show nothing to avoid flash
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0f14] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated → go to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Wrong role → redirect to their own dashboard, not a 403
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={ROLE_HOME[user.role]} replace />;
  }

  return <>{children}</>;
}
