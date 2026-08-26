import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { Compass } from 'lucide-react';
import { Layout } from './components/Layout.js';
import { Button, Card, EmptyState, FullScreenSpinner } from './components/ui.js';
import { useAuth } from './lib/auth.js';
import { WorkspaceProvider } from './lib/workspace.js';
import { TagScopeProvider } from './lib/projects.js';
import { ModeProvider } from './lib/mode.js';
import { Login } from './routes/Login.js';
import { ForgotPassword } from './routes/ForgotPassword.js';
import { ResetPassword } from './routes/ResetPassword.js';
import { AcceptInvite } from './routes/AcceptInvite.js';
import { Monitoring } from './routes/Monitoring.js';
import { About } from './routes/About.js';
import { Backups } from './routes/Backups.js';
import { Dashboard } from './routes/Dashboard.js';
import { Databases } from './routes/Databases.js';
import { DatabaseDetail } from './routes/DatabaseDetail.js';
import { Domains } from './routes/Domains.js';
import { Hub } from './routes/Hub.js';
import { ManifestCreator } from './routes/ManifestCreator.js';
import { ServiceDetail } from './routes/service/index.js';
import { ServicesList } from './routes/ServicesList.js';
import { Servers } from './routes/Servers.js';
import { Settings } from './routes/settings/index.js';
import { Sources } from './routes/Sources.js';
import { Topology } from './routes/Topology.js';
import { Tunnels } from './routes/Tunnels.js';
import { Users } from './routes/Users.js';
import { Workspaces } from './routes/Workspaces.js';
import { Volumes } from './routes/Volumes.js';
import { Networks } from './routes/Networks.js';
import { DockerDashboard } from './routes/Docker.js';
import { Traefik } from './routes/Traefik.js';
import { Activity } from './routes/Activity.js';
import { Projects } from './routes/Projects.js';
import { Labels } from './routes/Labels.js';

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
      {/* Public invitation accept — shown to anonymous visitors and
          authenticated users alike; the page itself routes them through
          login/register if they are not yet a member. */}
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route
        element={
          <RequireAuth>
            <WorkspaceProvider>
              <ModeProvider>
                <TagScopeProvider>
                  <Layout />
                </TagScopeProvider>
              </ModeProvider>
            </WorkspaceProvider>
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="dashboard" element={<Navigate to="/" replace />} />
        <Route path="workspaces" element={<Workspaces />} />
        <Route path="projects" element={<Projects />} />
        <Route path="labels" element={<Labels />} />
        <Route path="services" element={<ServicesList />} />
        <Route path="hub" element={<Hub />} />
        <Route path="manifest-creator" element={<ManifestCreator />} />
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
        <Route path="activity" element={<Activity />} />
        <Route path="traefik" element={<Traefik />} />
        <Route path="services/:id" element={<ServiceDetail />} />
        <Route path="databases/:id" element={<DatabaseDetail />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
