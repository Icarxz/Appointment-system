import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isSafeAppLink } from '../utils/deepLink';

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true; // malformed token, treat as expired
  }
}

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: string[];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const location = useLocation();
  const userRole = localStorage.getItem('userRole');
  const token = localStorage.getItem('token');
  const invalidSession = !userRole || !token || isTokenExpired(token);

  useEffect(() => {
    if (!invalidSession) return;
    window.dispatchEvent(new Event('ccis-logout'));
    localStorage.clear();
  }, [invalidSession]);

  if (invalidSession) {
    // Signed out (or session expired) while opening a notification link: remember where they were going,
    // so sign-in can continue there. Only an allowlisted path on this app is ever kept.
    const here = location.pathname + location.search;
    if (isSafeAppLink(here)) sessionStorage.setItem('intendedRoute', here);
    return <Navigate to="/" replace />;
  }

  if (!allowedRoles.includes(userRole)) {
    switch (userRole) {
      case 'FACULTY': return <Navigate to="/faculty-dashboard" replace />;
      case 'ADMIN': return <Navigate to="/admin-dashboard" replace />;
      case 'DEAN': return <Navigate to="/dean-dashboard" replace />;
      case 'STUDENT':
      default: return <Navigate to="/student-dashboard" replace />;
    }
  }

  return <>{children}</>;
}