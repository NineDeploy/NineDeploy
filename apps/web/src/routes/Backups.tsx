import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, HardDrive, RotateCcw, Trash2 } from 'lucide-react';
import { api, getToken } from '../lib/api.js';
import { Card, EmptyState, Skeleton, StatusBadge } from '../components/ui.js';

function fmtBytes(b: number): string {
  if (!b) return '—';
  const mb = b / 1024 ** 2;
  if (mb < 1) return `${(b / 1024).toFixed(0)} KB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

export function Backups() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['backups'], queryFn: () => api.backups.list() });
  const restore = useMutation({
    mutationFn: (b: { databaseId: number; id: number }) => api.backups.restore(b.databaseId, b.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.backups.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });

  const download = async (id: number) => {
    const res = await fetch(`/v1/backups/${id}/download`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup-${id}.dump`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Backups</h1>
        <p className="mt-1 text-sm text-slate-400">Database snapshots — back up, restore and download. Daily auto-backups keep the latest 7 per database.</p>
      </div>

      {list.isLoading ? (
        <Card className="p-5"><Skeleton className="h-8 w-full" /></Card>
      ) : !list.data || list.data.length === 0 ? (
        <Card>
          <EmptyState icon={<HardDrive size={26} />} title="No backups yet" hint="Use the Backup button on a database to create a snapshot." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Database</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Size</th>
                <th className="px-5 py-3 font-medium">Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-5 py-3 font-medium text-slate-200">{b.databaseName ?? '—'}</td>
                  <td className="px-5 py-3"><StatusBadge status={b.status} /></td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-400">{fmtBytes(b.sizeBytes)}</td>
                  <td className="px-5 py-3 text-xs text-slate-500">{new Date(b.createdAt).toLocaleString()}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => b.databaseId && confirm(`Restore ${b.databaseName ?? ''} from this backup? Current data will be overwritten.`) && restore.mutate({ databaseId: b.databaseId, id: b.id })}
                        className="rounded p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-indigo-300"
                        title="Restore"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button onClick={() => download(b.id)} className="rounded p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-sky-300" title="Download">
                        <Download size={14} />
                      </button>
                      <button onClick={() => remove.mutate(b.id)} className="rounded p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-rose-400" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
