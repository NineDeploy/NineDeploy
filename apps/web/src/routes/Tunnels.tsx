import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Cloud, Info, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.js';
import { Button, Card, ConfirmDialog, EmptyState, ErrorCard, Field, Input, PageHeader, Skeleton, StatusBadge } from '../components/ui.js';

export function Tunnels() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');

  const list = useQuery({ queryKey: ['tunnels'], queryFn: () => api.tunnels.list() });
  const create = useMutation({
    mutationFn: () => api.tunnels.create({ name, token }),
    onSuccess: () => {
      setOpen(false);
      setName('');
      setToken('');
      qc.invalidateQueries({ queryKey: ['tunnels'] });
      toast('Tunnel started', 'success');
    },
    onError: () => toast('Could not start the tunnel', 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.tunnels.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tunnels'] });
      toast('Tunnel deleted', 'success');
    },
    onError: () => toast('Could not delete the tunnel', 'error'),
  });

  return (
    <div>
      <PageHeader
        icon={<Cloud size={18} />}
        title="Tunnels"
        subtitle="Cloudflare Tunnels — expose services without opening any ports."
      />

      <Card className="mb-5 flex items-start gap-3 p-4">
        <Info size={16} className="mt-0.5 shrink-0 text-sky-400" />
        <p className="text-xs leading-relaxed text-slate-400">
          Create a tunnel in the <span className="text-slate-200">Cloudflare Zero Trust</span> dashboard (Networks → Tunnels →
          remote-managed), copy its <span className="font-mono text-slate-200">token</span>, and add it here. NineDeploy runs{' '}
          <span className="font-mono text-slate-200">cloudflared</span> on the shared network. Then map public hostnames in Cloudflare to{' '}
          <span className="font-mono text-emerald-300">http://ninedeploy-traefik:80</span> — your domains are served through the tunnel, no public ports needed.
        </p>
      </Card>

      <div className="mb-5 flex justify-end">
        <Button onClick={() => setOpen((v) => !v)}><Plus size={16} /> New tunnel</Button>
      </div>

      {open && (
        <Card className="mb-5 p-5 nd-fade">
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (name.trim() && token.trim()) create.mutate(); }} className="space-y-4">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="production" required /></Field>
            <Field label="Cloudflare tunnel token">
              <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJhIjoi…" required className="font-mono text-xs" />
            </Field>
            <div className="flex justify-end"><Button type="submit" disabled={create.isPending}>{create.isPending ? 'Starting…' : 'Start tunnel'}</Button></div>
          </form>
        </Card>
      )}

      {list.isLoading ? (
        <Card className="p-5"><Skeleton className="h-10 w-full" /></Card>
      ) : list.isError ? (
        <ErrorCard title="Couldn't load tunnels" error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data || list.data.length === 0 ? (
        <Card><EmptyState icon={<Cloud size={26} />} title="No tunnels" hint="Add a Cloudflare Tunnel token to expose services securely." /></Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Container</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((t) => (
                <tr key={t.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-5 py-3 font-medium text-slate-200">{t.name}</td>
                  <td className="px-5 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-5 py-3 font-mono text-[11px] text-slate-500">{t.containerName}</td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setPendingDelete({ id: t.id, name: t.name })} className="text-slate-600 transition hover:text-rose-400"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete tunnel"
        message={`Delete "${pendingDelete?.name}"? The cloudflared container stops and its hostnames stop resolving.`}
        confirmLabel="Delete"
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
