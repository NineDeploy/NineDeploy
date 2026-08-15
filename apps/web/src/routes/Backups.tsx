import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Download, HardDrive, RotateCcw, Trash2 } from 'lucide-react';
import { api, getToken } from '../lib/api.js';
import { Button, Card, EmptyState, Field, Input, Skeleton, StatusBadge, cn } from '../components/ui.js';

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

      <DestinationsCard />
    </div>
  );
}

// ── S3-compatible backup destinations (admin) ─────────────────────────────
function DestinationsCard() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', endpoint: '', region: '', bucket: '', prefix: '', accessKeyId: '', secretAccessKey: '' });
  const [showForm, setShowForm] = useState(false);

  const list = useQuery({ queryKey: ['backup-destinations'], queryFn: () => api.backupDestinations.list() });
  const create = useMutation({
    mutationFn: () => api.backupDestinations.create(form),
    onSuccess: () => {
      setShowForm(false);
      setForm({ name: '', endpoint: '', region: '', bucket: '', prefix: '', accessKeyId: '', secretAccessKey: '' });
      qc.invalidateQueries({ queryKey: ['backup-destinations'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.backupDestinations.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-destinations'] }),
  });
  const test = useMutation({
    mutationFn: (id: number) => api.backupDestinations.test(id),
    onSuccess: () => window.alert('Destination reachable — credentials work.'),
    onError: (err) => window.alert(err instanceof Error ? err.message : 'Test failed'),
  });
  const toggle = useMutation({
    mutationFn: (d: { id: number; active: boolean }) => api.backupDestinations.update(d.id, { active: !d.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-destinations'] }),
  });

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const canCreate = form.name && form.endpoint && form.bucket && form.accessKeyId && form.secretAccessKey;

  return (
    <Card className="mt-5">
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-slate-300">Off-site destinations (S3-compatible)</div>
          <Button size="sm" variant="secondary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Close' : 'Add destination'}
          </Button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Completed backups are also uploaded (still encrypted) to the active destination. Restore works from the remote copy when the local file is gone.
        </p>

        {showForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canCreate) create.mutate();
            }}
            className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2"
          >
            <Field label="Name"><Input value={form.name} onChange={set('name')} placeholder="minio-offsite" className="h-9" /></Field>
            <Field label="Endpoint URL"><Input value={form.endpoint} onChange={set('endpoint')} placeholder="https://s3.example.com" className="h-9 font-mono text-xs" /></Field>
            <Field label="Region"><Input value={form.region} onChange={set('region')} placeholder="us-east-1" className="h-9" /></Field>
            <Field label="Bucket"><Input value={form.bucket} onChange={set('bucket')} placeholder="ninedeploy-backups" className="h-9 font-mono text-xs" /></Field>
            <Field label="Prefix"><Input value={form.prefix} onChange={set('prefix')} placeholder="ninedeploy" className="h-9 font-mono text-xs" /></Field>
            <Field label="Access key ID"><Input value={form.accessKeyId} onChange={set('accessKeyId')} className="h-9 font-mono text-xs" /></Field>
            <Field label="Secret access key"><Input type="password" value={form.secretAccessKey} onChange={set('secretAccessKey')} className="h-9 font-mono text-xs" /></Field>
            <div className="flex items-end">
              <Button type="submit" size="sm" disabled={!canCreate || create.isPending}>
                {create.isPending ? 'Saving…' : 'Save destination'}
              </Button>
            </div>
          </form>
        )}

        <div className="space-y-1.5">
          {list.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : !list.data || list.data.length === 0 ? (
            <p className="py-2 text-xs text-slate-600">No destinations — backups stay local only.</p>
          ) : (
            list.data.map((d) => (
              <div key={d.id} className="group flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-inset ring-white/5">
                <div className="min-w-0">
                  <span className="text-sm text-slate-200">{d.name}</span>
                  <span className="ml-2 truncate font-mono text-[11px] text-slate-500">
                    {d.endpoint}/{d.bucket}/{d.prefix}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => toggle.mutate({ id: d.id, active: d.active })}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset transition',
                      d.active ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/20' : 'bg-slate-500/15 text-slate-400 ring-slate-500/20',
                    )}
                  >
                    {d.active ? 'active' : 'paused'}
                  </button>
                  <button onClick={() => test.mutate(d.id)} className="text-xs text-slate-500 hover:text-indigo-300" title="Test connection">
                    test
                  </button>
                  <button onClick={() => remove.mutate(d.id)} className="text-slate-600 transition hover:text-rose-400" title="Remove destination">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
