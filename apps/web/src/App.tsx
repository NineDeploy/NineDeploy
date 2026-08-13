import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout.js';
import { FullScreenSpinner } from './components/ui.js';
import { useAuth } from './lib/auth.js';
import { Login } from './routes/Login.js';
import { NewService } from './routes/NewService.js';
import { Databases } from './routes/Databases.js';
import { ServiceDetail } from './routes/ServiceDetail.js';
import { ServicesList } from './routes/ServicesList.js';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return <FullScreenSpinner />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<ServicesList />} />
        <Route path="databases" element={<Databases />} />
        <Route path="services/new" element={<NewService />} />
        <Route path="services/:id" element={<ServiceDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
