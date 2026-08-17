import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { Compass } from 'lucide-react';
import { Layout } from './components/Layout.js';
import { Button, Card, EmptyState, FullScreenSpinner } from './components/ui.js';
import { useAuth } from './lib/auth.js';
import { Login } from './routes/Login.js';
import { ForgotPassword } from './routes/ForgotPassword.js';
import { ResetPassword } from './routes/ResetPassword.js';
import { Monitoring } from './routes/Monitoring.js';
import { About } from './routes/About.js';
import { Backups } from './routes/Backups.js';
import { Dashboard } from './routes/Dashboard.js';
import { Databases } from './routes/Databases.js';
import { Domains } from './routes/Domains.js';
import { Hub } from './routes/Hub.js';
import { ServiceDetail } from './routes/service/index.js';
import { ServicesList } from './routes/ServicesList.js';
import { Servers } from './routes/Servers.js';
import { Settings } from './routes/settings/index.js';
import { Sources } from './routes/Sources.js';
import { Topology } from './routes/Topology.js';
import { Tunnels } from './routes/Tunnels.js';
import { Users } from './routes/Users.js';
import { Volumes } from './routes/Volumes.js';
import { Networks } from './routes/Networks.js';
import { DockerDashboard } from './routes/Docker.js';
import { Traefik } from './routes/Traefik.js';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Wildcard fallback for unknown paths. */
function NotFound() {
  return (
    <Card>
      <EmptyState
        icon={<Compass size={26} />}
        title="Not found"
        hint="The page you are looking for does not exist."
        action={<Link to="/"><Button size="sm">Back to dashboard</Button></Link>}
      />
    </Card>
  );
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
        <Route path="dashboard" element={<Navigate to="/" replace />} />
        <Route path="services" element={<ServicesList />} />
        <Route path="hub" element={<Hub />} />
        <Route path="databases" element={<Databases />} />
        <Route path="domains" element={<Domains />} />
        <Route path="tunnels" element={<Tunnels />} />
        <Route path="users" element={<Users />} />
        <Route path="volumes" element={<Volumes />} />
        <Route path="networks" element={<Networks />} />
        <Route path="docker" element={<DockerDashboard />} />
        <Route path="topology" element={<Topology />} />
        <Route path="backups" element={<Backups />} />
        <Route path="sources" element={<Sources />} />
        <Route path="servers" element={<Servers />} />
        <Route path="settings" element={<Settings />} />
        <Route path="about" element={<About />} />
        <Route path="monitoring" element={<Monitoring />} />
        <Route path="traefik" element={<Traefik />} />
        <Route path="services/:id" element={<ServiceDetail />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
