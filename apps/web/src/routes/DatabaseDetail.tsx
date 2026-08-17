import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import type { DatabaseDetail as IDatabaseDetail } from '@ninedeploy/sdk';
import { api, authedFetch } from '../lib/api.js';
import { useToast } from '../components/Toast.js';
import {
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  ErrorCard,
  Field,
  Input,
  Skeleton,
  StatusBadge,
  Tabs,
} from '../components/ui.js';
import { downloadBlob, formatBytes, formatDateTime, useCopy } from '../lib/format.js';

const ENGINE_LABEL: Record<string, string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  redis: 'Redis',
  mongo: 'MongoDB',
};

export function DatabaseDetail() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'overview' | 'backups' | 'logs' | 'settings'>('overview');

  const dbQuery = useQuery({
    queryKey: ['database-detail', id],
    queryFn: () => api.databases.get(id),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: 10000,
  });

  const restartMutation = useMutation({
    mutationFn: () => api.databases.restart(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['database-detail', id] });
      toast('Database restarted', 'success');
    },
    onError: () => toast('Could not restart database', 'error'),
  });

  const stopMutation = useMutation({
    mutationFn: () => api.databases.stop(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['database-detail', id] });
      toast('Database stopped', 'success');
    },
    onError: () => toast('Could not stop database', 'error'),
  });

  const startMutation = useMutation({
    mutationFn: () => api.databases.start(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['database-detail', id] });
      toast('Database started', 'success');
    },
    onError: () => toast('Could not start database', 'error'),
  });

  const backupMutation = useMutation({
    mutationFn: () => api.backups.backupNow(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      toast('Backup snapshot started', 'success');
    },
    onError: () => toast('Backup failed', 'error'),
  });

  if (dbQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (dbQuery.isError || !dbQuery.data) {
    return (
      <ErrorCard
        title="Database not found"
        error={dbQuery.error}
        onRetry={() => void dbQuery.refetch()}
      />
    );
  }

  const db = dbQuery.data;
  const isRunning = db.status === 'running';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          to="/databases"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-200"
        >
          <ArrowLeft size={13} /> Back to databases
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/30">
              <Database size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">{db.name}</h1>
                <StatusBadge status={db.status} />
              </div>
              <p className="font-mono text-xs text-slate-400">
                {ENGINE_LABEL[db.engine] ?? db.engine}
                {db.version ? ` v${db.version}` : ''} · {db.host}:{db.port}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isRunning ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
              >
                <Square size={13} className="fill-current" />
                Stop
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
              >
                <Play size={13} className="fill-current text-emerald-400" />
                Start
              </Button>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => restartMutation.mutate()}
              disabled={restartMutation.isPending || !isRunning}
            >
              <RefreshCw size={13} />
              Restart
            </Button>

            <Button
              size="sm"
              onClick={() => backupMutation.mutate()}
              disabled={backupMutation.isPending || !isRunning}
            >
              <Download size={13} />
              Backup now
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        active={activeTab}
        onChange={(t) => setActiveTab(t as any)}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'backups', label: 'Backups' },
          { id: 'logs', label: 'Logs' },
          { id: 'settings', label: 'Settings' },
        ]}
      />

      {/* Tab Panels */}
      {activeTab === 'overview' && <OverviewPanel db={db} />}
      {activeTab === 'backups' && <BackupsPanel dbId={db.id} dbName={db.name} />}
      {activeTab === 'logs' && <LogsPanel dbId={db.id} isRunning={isRunning} />}
      {activeTab === 'settings' && <SettingsPanel db={db} onDeleted={() => navigate('/databases')} />}
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewPanel({ db }: { db: IDatabaseDetail }) {
  const { copied, copy } = useCopy();
  const [showPassword, setShowPassword] = useState(false);

  const credsQuery = useQuery({
    queryKey: ['database-credentials', db.id],
    queryFn: () => api.databases.credentials(db.id),
  });

  const creds = credsQuery.data;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Connection info */}
      <div className="space-y-6">
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Connection Details</h2>
            {db.connectionString && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void copy(db.connectionString!)}
                className="text-xs"
              >
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy URI'}
              </Button>
            )}
          </div>

          {db.connectionString ? (
            <div className="rounded-xl border border-white/[0.08] bg-black/40 p-3 font-mono text-xs text-indigo-300 break-all select-all">
              {db.connectionString}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-slate-500">
              Database is stopped. Start database to generate active connection string.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2.5">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Host (Internal)</span>
              <span className="font-mono text-slate-200">{db.host}</span>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2.5">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Port</span>
              <span className="font-mono text-slate-200">{db.port}</span>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2.5">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Username</span>
              <span className="font-mono text-slate-200">{db.username}</span>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2.5">
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Database</span>
              <span className="font-mono text-slate-200">{db.database}</span>
            </div>
          </div>

          {creds && (
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 flex items-center justify-between">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Password</span>
                <span className="font-mono text-xs text-slate-200">
                  {showPassword ? creds.password : '••••••••••••••••'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="rounded p-1 text-slate-400 hover:text-slate-200 transition"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => void copy(creds.password)}
                  className="rounded p-1 text-slate-400 hover:text-slate-200 transition"
                  title="Copy password"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Runtime info card */}
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Runtime &amp; Storage</h2>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between border-b border-white/[0.04] pb-1.5">
              <dt className="text-slate-500">Container</dt>
              <dd className="font-mono text-slate-200">{db.containerName ?? `nd-db-${db.slug}`}</dd>
            </div>
            <div className="flex justify-between border-b border-white/[0.04] pb-1.5">
              <dt className="text-slate-500">Volume</dt>
              <dd className="font-mono text-slate-200">{db.volumeName ?? `nd-db-${db.slug}-data`}</dd>
            </div>
            <div className="flex justify-between border-b border-white/[0.04] pb-1.5">
              <dt className="text-slate-500">Created</dt>
              <dd className="text-slate-300">{formatDateTime(db.createdAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">CPU / RAM Limit</dt>
              <dd className="font-mono text-slate-200">
                {db.cpuShares ? `${db.cpuShares} shares` : 'Unlimited'} / {db.memLimitMb ? `${db.memLimitMb} MB` : 'Unlimited'}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      {/* Linked services */}
      <div className="space-y-6">
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Linked Applications</h2>
            <span className="rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-xs font-medium text-indigo-300">
              {db.attachedServices.length} attached
            </span>
          </div>

          {db.attachedServices.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">
              No services are linked to this database yet. You can attach this database in the service's Environment tab.
            </div>
          ) : (
            <div className="space-y-2">
              {db.attachedServices.map((svc) => (
                <Link
                  key={svc.id}
                  to={`/services/${svc.id}`}
                  className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition hover:border-indigo-500/30 hover:bg-white/[0.04]"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300">
                      <Server size={15} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-200">{svc.name}</div>
                      <div className="font-mono text-[10px] text-slate-500">{svc.slug}</div>
                    </div>
                  </div>
                  <span className="text-xs text-indigo-400 font-medium">View service &rarr;</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Backups Tab ──────────────────────────────────────────────────────────────
function BackupsPanel({ dbId, dbName }: { dbId: number; dbName: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pendingRestore, setPendingRestore] = useState<{ id: number; createdAt: string } | null>(null);

  const backupsQuery = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.backups.list(),
  });

  const dbBackups = useMemo(() => {
    return (backupsQuery.data ?? []).filter((b) => b.databaseId === dbId);
  }, [backupsQuery.data, dbId]);

  const restoreMutation = useMutation({
    mutationFn: (backupId: number) => api.backups.restore(dbId, backupId),
    onSuccess: () => {
      setPendingRestore(null);
      qc.invalidateQueries({ queryKey: ['backups'] });
      toast('Database restore started', 'success');
    },
    onError: () => toast('Restore failed', 'error'),
  });

  const downloadBackup = async (id: number) => {
    try {
      const res = await authedFetch(`/v1/backups/${id}/download`);
      if (!res.ok) {
        toast('Download failed', 'error');
        return;
      }
      downloadBlob(await res.blob(), `${dbName}-backup-${id}.dump`);
    } catch {
      toast('Download failed', 'error');
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Database Snapshots</h2>
        <span className="text-xs text-slate-500">{dbBackups.length} snapshot(s)</span>
      </div>

      {dbBackups.length === 0 ? (
        <CardBody>
          <EmptyState
            icon={<HardDrive size={24} />}
            title="No snapshots yet"
            hint="Create a snapshot using the 'Backup now' button in the top right."
          />
        </CardBody>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Size</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {dbBackups.map((b) => (
              <tr key={b.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                <td className="px-5 py-3">
                  <StatusBadge status={b.status} />
                </td>
                <td className="px-5 py-3 font-mono text-xs text-slate-400">{formatBytes(b.sizeBytes)}</td>
                <td className="px-5 py-3 text-xs text-slate-500">{formatDateTime(b.createdAt)}</td>
                <td className="px-5 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPendingRestore({ id: b.id, createdAt: b.createdAt })}
                      className="text-xs"
                      title="Restore database snapshot"
                    >
                      <RotateCcw size={12} /> Restore
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void downloadBackup(b.id)}
                      className="text-xs"
                      title="Download dump file"
                    >
                      <Download size={12} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pendingRestore && (
        <ConfirmDialog
          open={true}
          title="Restore Database Snapshot"
          message={`Are you sure you want to restore the snapshot from ${formatDateTime(pendingRestore.createdAt)}? The database will restart and current data will be replaced.`}
          confirmLabel="Restore Snapshot"
          onConfirm={() => restoreMutation.mutate(pendingRestore.id)}
          onClose={() => setPendingRestore(null)}
        />
      )}
    </Card>
  );
}

// ── Logs Tab ─────────────────────────────────────────────────────────────────
function LogsPanel({ dbId, isRunning }: { dbId: number; isRunning: boolean }) {
  const [lines, setLines] = useState('100');
  const { copy } = useCopy();

  const logsQuery = useQuery({
    queryKey: ['database-logs', dbId, lines],
    queryFn: () => api.databases.logs(dbId, Number(lines)),
    enabled: isRunning,
    refetchInterval: 5000,
  });

  const logs = logsQuery.data?.logs ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-white/[0.06] flex items-center justify-between bg-white/[0.01]">
        <div className="flex items-center gap-2">
          <Terminal size={15} className="text-indigo-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Database Engine Logs</h2>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={lines}
            onChange={(e) => setLines(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-slate-300 outline-none"
          >
            <option value="50">50 lines</option>
            <option value="100">100 lines</option>
            <option value="250">250 lines</option>
            <option value="500">500 lines</option>
          </select>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => void copy(logs.join('\n'))}
            disabled={logs.length === 0}
            className="text-xs"
          >
            <Copy size={12} /> Copy logs
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => void logsQuery.refetch()}
            disabled={logsQuery.isFetching}
            className="text-xs"
            title="Refresh logs"
          >
            <RefreshCw size={12} className={logsQuery.isFetching ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      <div className="p-4 bg-slate-950 font-mono text-xs text-slate-300 max-h-[500px] overflow-y-auto space-y-0.5">
        {!isRunning ? (
          <div className="py-8 text-center text-slate-500">Database is stopped. Start database to stream logs.</div>
        ) : logs.length === 0 ? (
          <div className="py-8 text-center text-slate-500">No logs captured yet.</div>
        ) : (
          logs.map((line, idx) => (
            <div key={idx} className="whitespace-pre-wrap break-all hover:bg-white/[0.02] py-0.5">
              {line}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ── Settings Tab ─────────────────────────────────────────────────────────────
function SettingsPanel({ db, onDeleted }: { db: IDatabaseDetail; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [cpuShares, setCpuShares] = useState(db.cpuShares ? String(db.cpuShares) : '');
  const [memLimitMb, setMemLimitMb] = useState(db.memLimitMb ? String(db.memLimitMb) : '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);

  const limitsMutation = useMutation({
    mutationFn: () =>
      api.databases.setLimits(db.id, {
        cpuShares: cpuShares.trim() ? Number(cpuShares) : undefined,
        memLimitMb: memLimitMb.trim() ? Number(memLimitMb) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['database-detail', db.id] });
      toast('Resource limits updated and applied', 'success');
    },
    onError: () => toast('Could not update limits', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.databases.remove(db.id, { force: forceDelete }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['databases'] });
      toast('Database deleted', 'success');
      onDeleted();
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Delete failed', 'error'),
  });

  return (
    <div className="max-w-2xl space-y-6">
      {/* Resource Limits */}
      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Resource Allocations</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="CPU Shares (relative weight, e.g. 1024)">
            <Input
              type="number"
              placeholder="e.g. 1024"
              value={cpuShares}
              onChange={(e) => setCpuShares(e.target.value)}
            />
          </Field>
          <Field label="Memory Limit (MB)">
            <Input
              type="number"
              placeholder="e.g. 512"
              value={memLimitMb}
              onChange={(e) => setMemLimitMb(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => limitsMutation.mutate()}
            disabled={limitsMutation.isPending}
          >
            Save resource limits
          </Button>
        </div>
      </Card>

      {/* Danger Zone */}
      <Card className="p-5 border-rose-500/20 bg-rose-500/[0.02] space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-rose-400 uppercase tracking-wider">Danger Zone</h2>
          <p className="text-xs text-slate-400 mt-1">
            Deleting this database will permanently stop the container. Persistent volume storage is retained for safety.
          </p>
        </div>

        {db.attachedServices.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-amber-200">
            <strong>Warning:</strong> This database is actively linked to {db.attachedServices.length} service(s):{' '}
            {db.attachedServices.map((s) => s.name).join(', ')}.
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={forceDelete}
              onChange={(e) => setForceDelete(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 text-indigo-500"
            />
            Force delete even if services are attached
          </label>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={13} /> Delete database
          </Button>
        </div>
      </Card>

      {confirmDelete && (
        <ConfirmDialog
          open={true}
          title={`Delete "${db.name}"?`}
          message={`Are you sure you want to delete database "${db.name}"? This action cannot be undone.`}
          confirmLabel="Delete Database"
          onConfirm={() => deleteMutation.mutate()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
