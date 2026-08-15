import { type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Layout } from './components/Layout.js';
import { FullScreenSpinner } from './components/ui.js';
import { useAuth } from './lib/auth.js';
import { Login } from './routes/Login.js';
import { ForgotPassword } from './routes/ForgotPassword.js';
import { ResetPassword } from './routes/ResetPassword.js';
import { Monitoring } from './routes/Monitoring.js';
import { NewService } from './routes/NewService.js';
import { About } from './routes/About.js';
import { Backups } from './routes/Backups.js';
import { Dashboard } from './routes/Dashboard.js';
import { Databases } from './routes/Databases.js';
import { Domains } from './routes/Domains.js';
import { Hub } from './routes/Hub.js';
import { ServiceDetail } from './routes/ServiceDetail.js';
import { ServicesList } from './routes/ServicesList.js';
import { Servers } from './routes/Servers.js';
import { Settings } from './routes/Settings.js';
import { Sources } from './routes/Sources.js';
import { Topology } from './routes/Topology.js';
import { Tunnels } from './routes/Tunnels.js';
import { Users } from './routes/Users.js';
import { Volumes } from './routes/Volumes.js';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return <FullScreenSpinner />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="services" element={<ServicesList />} />
        <Route path="hub" element={<Hub />} />
        <Route path="databases" element={<Databases />} />
        <Route path="domains" element={<Domains />} />
        <Route path="tunnels" element={<Tunnels />} />
        <Route path="users" element={<Users />} />
        <Route path="volumes" element={<Volumes />} />
        <Route path="topology" element={<Topology />} />
        <Route path="backups" element={<Backups />} />
        <Route path="sources" element={<Sources />} />
        <Route path="servers" element={<Servers />} />
        <Route path="settings" element={<Settings />} />
        <Route path="about" element={<About />} />
        <Route path="monitoring" element={<Monitoring />} />
        <Route path="services/new" element={<NewService />} />
        <Route path="services/:id" element={<ServiceDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
