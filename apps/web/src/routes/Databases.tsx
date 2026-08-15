import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Check, Copy, Database, HardDriveDownload, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useProjectScope } from '../lib/projects.js';
import { useToast } from '../components/Toast.js';
import { Button, Card, ConfirmDialog, EmptyState, ErrorCard, PageHeader, Skeleton, StatusBadge, cn } from '../components/ui.js';
import { useCopy } from '../lib/format.js';
import { StorageGauge } from '../components/StorageGauge.js';
import { DatabaseWizard } from '../components/DatabaseWizard.js';

const ENGINE_LABEL: Record<string, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', redis: 'Redis', mongo: 'MongoDB' };

export function Databases() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [wizard, setWizard] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<{ id: number; name: string } | null>(null);
  const { copied, copy } = useCopy();
  const { selectedId } = useProjectScope();

  const list = useQuery({
    queryKey: ['databases', selectedId],
    queryFn: () => api.databases.list(selectedId != null ? `?projectId=${selectedId}` : ''),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.databases.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['databases'] });
      toast('Database deleted — its volume was kept (retained)', 'success');
    },
    onError: () => toast('Could not delete the database', 'error'),
  });
  const backup = useMutation({
    mutationFn: (id: number) => api.backups.backupNow(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
      toast('Backup started', 'success');
    },
    onError: () => toast('Backup failed', 'error'),
  });

  return (
    <div>
      <PageHeader
        icon={<Database size={18} />}
        title="Databases"
        subtitle="Managed databases with persistent storage."
        actions={
          <Button onClick={() => setWizard(true)}>
            <Plus size={16} /> New database
          </Button>
        }
      />

      {wizard && <DatabaseWizard onClose={() => setWizard(false)} />}

      {list.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-3 h-3 w-2/3" />
            </Card>
          ))}
        </div>
      ) : list.isError ? (
        <ErrorCard title="Couldn't load databases" error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data || list.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Database size={26} />}
            title="No databases"
            hint="Spin up a managed Postgres, MySQL, Redis or MongoDB instance."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((d) => (
            <Card key={d.id} interactive className="flex h-full flex-col p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.04] text-indigo-300 ring-1 ring-inset ring-white/10">
                    <Database size={18} />
                  </div>
                  <div>
                    <div className="font-semibold leading-tight">{d.name}</div>
                    <div className="font-mono text-[11px] text-slate-500">{ENGINE_LABEL[d.engine] ?? d.engine}{d.version ? ` ${d.version}` : ''}</div>
                  </div>
                </div>
                <StatusBadge status={d.status} />
              </div>

              <div className="mt-4 flex-1">
                {d.connectionString ? (
                  <button type="button"
                    onClick={() => void copy(d.connectionString!)}
                    className="group flex w-full items-center gap-2 rounded-lg bg-black/30 px-2.5 py-2 text-left ring-1 ring-inset ring-white/5 hover:ring-white/15"
                    title="Copy connection string"
                  >
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-emerald-300/90">
                      {d.connectionString}
                    </code>
                    {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} className="shrink-0 text-slate-500" />}
                  </button>
                ) : (
                  <div className="rounded-lg bg-black/20 px-2.5 py-2 text-[11px] text-slate-600">Not running</div>
                )}
                {d.status === 'running' && (
                  <div className="mt-3">
                    <StorageGauge databaseId={d.id} />
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <button type="button"
                  onClick={() => backup.mutate(d.id)}
                  disabled={backup.isPending}
                  className="flex items-center gap-1 text-xs text-slate-400 transition hover:text-indigo-300 disabled:opacity-50"
                >
                  <HardDriveDownload size={12} /> Backup
                </button>
                <button type="button"
                  onClick={() => setPendingRemove({ id: d.id, name: d.name })}
                  className={cn('flex items-center gap-1 text-xs text-slate-600 transition hover:text-rose-400')}
                >
                  <Trash2 size={12} /> Remove
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingRemove != null}
        title="Delete database"
        message={`Delete "${pendingRemove?.name}"? The container is removed; its data volume is kept and can be freed under Volumes.`}
        confirmLabel="Delete"
        onConfirm={() => pendingRemove && remove.mutate(pendingRemove.id)}
        onClose={() => setPendingRemove(null)}
      />
    </div>
  );
}
