import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Download, ExternalLink, GitBranch, Play, Rocket, RotateCcw, Square, Terminal,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, authedFetch } from '../../lib/api.js';
import { ContainerTerminal } from '../../components/ContainerTerminal.js';
import { useToast } from '../../components/Toast.js';
import { Button, Card, CardBody, Skeleton, StatusBadge, Tabs } from '../../components/ui.js';
import { downloadBlob } from '../../lib/format.js';
import { OverviewTab } from './OverviewTab.js';
import { ArchitectureTab } from './ArchitectureTab.js';
import { ManifestTab } from './ManifestTab.js';
import { DeploysTab, IN_FLIGHT } from './DeploysTab.js';
import { EnvironmentTab } from './EnvironmentTab.js';
import { NetworkTab } from './NetworkTab.js';
import { SettingsTab } from './SettingsTab.js';
import { ActivityTab } from './ActivityTab.js';
import { DangerZone } from './DangerZone.js';

import { ContainerFileBrowser } from '../../components/ContainerFileBrowser.js';

type TabId = 'overview' | 'architecture' | 'manifest' | 'deploys' | 'environment' | 'network' | 'files' | 'settings' | 'activity' | 'danger';

export function ServiceDetail() {
  const params = useParams();
  const id = Number(params['id']);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeDeploy, setActiveDeploy] = useState<number | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const navigate = useNavigate();

  // A non-numeric :id (e.g. /services/abc) must not leak NaN into every
  // query/mutation — treat it as "not found" and bounce to the list.
  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) navigate('/services', { replace: true });
  }, [id, navigate]);

  const service = useQuery({
    queryKey: ['service', id],
    queryFn: () => api.services.get(id),
    refetchInterval: (q) => (q.state.data?.status === 'deploying' ? 2000 : false),
  });
  const deploys = useQuery({
    queryKey: ['deploys', id],
    queryFn: () => api.deploys.list(id),
    refetchInterval: (q) => (q.state.data?.some((d) => IN_FLIGHT.includes(d.status)) ? 2000 : false),
  });

  useEffect(() => {
    if (activeDeploy != null) return;
    const latest = deploys.data?.[0];
    if (latest) setActiveDeploy(latest.id);
  }, [deploys.data, activeDeploy]);

  const trigger = useMutation({
    mutationFn: () => api.deploys.trigger(id),
    onSuccess: (res) => {
      setActiveDeploy(res.deploymentId);
      setTab('deploys');
      qc.invalidateQueries({ queryKey: ['deploys', id] });
      qc.invalidateQueries({ queryKey: ['service', id] });
    },
  });

  const lifecycle = useMutation({
    mutationFn: (action: 'stop' | 'start' | 'restart') => api.services[action](id),
    onSuccess: (_d, action) => {
      qc.invalidateQueries({ queryKey: ['service', id] });
      toast(`Service ${action}ed`, 'success');
    },
    onError: () => toast('Action failed', 'error'),
  });

  // Danger zone: delete the service (type-the-name confirm).
  const [confirmDelete, setConfirmDelete] = useState('');
  const removeService = useMutation({
    mutationFn: () => api.services.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Service deleted', 'success');
      navigate('/services');
    },
    onError: () => toast('Delete failed', 'error'),
  });

  const [showRuntimeLogs, setShowRuntimeLogs] = useState(false);
  const [showExec, setShowExec] = useState(false);

  const doExportService = async () => {
    try {
      toast('Exporting service…', 'info');
      const res = await authedFetch(api.services.exportUrl(id));
      if (!res.ok) throw new Error('Export failed');
      downloadBlob(await res.blob(), `${svc?.slug ?? 'service'}-export.json`);
      toast('Service exported', 'success');
    } catch {
      toast('Export failed', 'error');
    }
  };
  const runtimeLogs = useQuery({
    queryKey: ['runtime-logs', id],
    queryFn: () => api.services.logs(id),
    enabled: showRuntimeLogs && !!service.data?.runtimeId,
    refetchInterval: showRuntimeLogs ? 3000 : false,
  });

  const svc = service.data;
  const activeDeployRow = deploys.data?.find((d) => d.id === activeDeploy) ?? null;

  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    const cur = activeDeployRow?.status ?? null;
    const wasInFlight = lastStatus.current != null && IN_FLIGHT.includes(lastStatus.current);
    const nowTerminal = cur != null && !IN_FLIGHT.includes(cur);
    if (wasInFlight && nowTerminal) qc.invalidateQueries({ queryKey: ['service', id] });
    lastStatus.current = cur;
  }, [activeDeployRow?.status, qc, id]);

  if (service.isError) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm font-medium text-rose-300">Couldn't load this service.</p>
        <p className="mt-1 text-xs text-slate-500">It may have been deleted, or the server is unreachable.</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => service.refetch()}>Retry</Button>
          <Link to="/services"><Button size="sm" variant="ghost">Back to services</Button></Link>
        </div>
      </Card>
    );
  }

  if (service.isLoading || !svc) {
    return (
      <Card className="p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="mt-3 h-4 w-2/3" />
      </Card>
    );
  }

  return (
    <div className="nd-fade">
      <Link to="/services" className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-slate-200">
        <ArrowLeft size={14} /> Services
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{svc.name}</h1>
            <StatusBadge status={svc.status} />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-500">
            <span className="uppercase tracking-wide text-slate-400">{svc.type}</span>
            <span className="flex items-center gap-1">
              <GitBranch size={12} /> {svc.branch}
            </span>
            {svc.port && <span>: {svc.port}</span>}
            <span className="truncate">{svc.repoUrl ?? svc.image}</span>
          </p>
          {svc.autoUrl && (
            <a
              href={`http://${svc.autoUrl}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 font-mono text-xs text-emerald-300 ring-1 ring-inset ring-emerald-500/20 transition hover:bg-emerald-500/15"
            >
              <ExternalLink size={12} /> {svc.autoUrl}
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => trigger.mutate()} disabled={trigger.isPending}>
            <Rocket size={16} /> {trigger.isPending ? 'Triggering…' : 'Deploy'}
          </Button>
          {svc.status === 'running' && (
            <>
              <Button variant="secondary" size="md" onClick={() => lifecycle.mutate('restart')} disabled={lifecycle.isPending} title="Restart">
                <RotateCcw size={15} /> Restart
              </Button>
              <Button variant="secondary" size="md" onClick={() => lifecycle.mutate('stop')} disabled={lifecycle.isPending} title="Stop">
                <Square size={15} /> Stop
              </Button>
            </>
          )}
          {svc.status === 'stopped' && (
            <Button variant="secondary" size="md" onClick={() => lifecycle.mutate('start')} disabled={lifecycle.isPending}>
              <Play size={15} /> Start
            </Button>
          )}
          {svc.runtimeId && (
            <Button variant="ghost" size="md" onClick={() => setShowRuntimeLogs((v) => !v)}>
              <Terminal size={15} /> {showRuntimeLogs ? 'Hide logs' : 'Runtime logs'}
            </Button>
          )}
          {svc.runtimeId && (
            <Button variant="ghost" size="md" onClick={() => setShowExec((v) => !v)}>
              <Terminal size={15} /> {showExec ? 'Hide shell' : 'Exec'}
            </Button>
          )}
          <Button variant="ghost" size="md" onClick={doExportService} title="Export service">
            <Download size={15} /> Export
          </Button>
        </div>
      </div>

      {showRuntimeLogs && (
        <Card className="mt-5">
          <CardBody>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <Terminal size={15} className="text-slate-500" /> Runtime logs
              </div>
              <span className="text-xs text-slate-600">live · auto-refresh 3s</span>
            </div>
            <pre className="h-72 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-xs leading-relaxed text-slate-300 ring-1 ring-inset ring-white/5">
              {runtimeLogs.data?.lines || 'No logs yet.'}
            </pre>
          </CardBody>
        </Card>
      )}

      {showExec && svc.runtimeId && (
        <div className="mt-5">
          <ContainerTerminal serviceId={id} onClose={() => setShowExec(false)} />
        </div>
      )}

      <Tabs
        className="mt-6"
        active={tab}
        onChange={(t) => setTab(t as TabId)}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'architecture', label: 'Architecture' },
          { id: 'manifest', label: 'Manifest & Traefik' },
          { id: 'deploys', label: 'Deploys' },
          { id: 'environment', label: 'Environment' },
          { id: 'network', label: 'Network' },
          { id: 'files', label: 'Files' },
          { id: 'settings', label: 'Settings' },
          { id: 'activity', label: 'Activity' },
          { id: 'danger', label: 'Danger' },
        ]}
      />

      {tab === 'overview' && <OverviewTab serviceId={id} svc={svc} />}
      {tab === 'architecture' && <ArchitectureTab service={svc} />}
      {tab === 'manifest' && <ManifestTab service={svc} />}
      {tab === 'deploys' && (
        <DeploysTab
          serviceId={id}
          deploys={deploys.data ?? []}
          loading={deploys.isLoading}
          activeId={activeDeploy}
          onSelect={setActiveDeploy}
        />
      )}
      {tab === 'environment' && <EnvironmentTab serviceId={id} />}
      {tab === 'network' && <NetworkTab serviceId={id} svc={svc} />}
      {tab === 'files' && (
        <div className="mt-5">
          <ContainerFileBrowser container={svc.runtimeId || `nd-svc-${svc.slug}`} />
        </div>
      )}
      {tab === 'settings' && <SettingsTab serviceId={id} svc={svc} />}
      {tab === 'activity' && <ActivityTab serviceId={id} name={svc.name} />}

      {/* Danger zone lives in its own tab so it never reads as part of
          everyday settings. */}
      {tab === 'danger' && (
        <DangerZone
          slug={svc.slug}
          name={svc.name}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
          onDelete={() => removeService.mutate()}
          deleting={removeService.isPending}
        />
      )}
    </div>
  );
}
