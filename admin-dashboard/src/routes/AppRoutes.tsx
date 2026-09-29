import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { DashboardLayout } from '../components/layout/DashboardLayout'
import { useAuth } from '../hooks/useAuth'
import { Login } from '../pages/auth/Login'
import { Sessions } from '../pages/ask-prana/Sessions'
import { Messages } from '../pages/ask-prana/Messages'
import { Usage } from '../pages/ask-prana/Usage'
import { ProtectedRoute } from './ProtectedRoute'
import { AskPranaMonitor } from '../pages/ask-prana/AskPranaMonitor'

function GuestOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestOnly>
            <Login />
          </GuestOnly>
        }
      />

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route index element={<Navigate to="/ask-prana" replace />} />
          <Route path="ask-prana" element={<AskPranaMonitor />} />
          <Route path="ask-prana/sessions" element={<Sessions />} />
          <Route path="ask-prana/messages" element={<Messages />} />
          <Route path="ask-prana/usage" element={<Usage />} />
          <Route path="aquagpt" element={<Navigate to="/ask-prana" replace />} />
          <Route path="aquagpt/sessions" element={<Navigate to="/ask-prana/sessions" replace />} />
          <Route path="aquagpt/messages" element={<Navigate to="/ask-prana/messages" replace />} />
          <Route path="aquagpt/usage" element={<Navigate to="/ask-prana/usage" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
