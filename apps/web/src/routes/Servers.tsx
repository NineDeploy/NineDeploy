import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { HardDrive, Plus, Server as ServerIcon, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.js';
import { Button, Card, ConfirmDialog, EmptyState, ErrorCard, Field, Input, PageHeader, Skeleton, cn } from '../components/ui.js';
import { formatRelative, useCopy } from '../lib/format.js';

/**
 * Remote server registry (admin). Registering prints the one-time agent token
 * + the exact command to run on the target host.
 */
export function Servers() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('4600');
  const [revealed, setRevealed] = useState<{ token: string; tokenSha256: string; agentCommand: string } | null>(null);
  const { copied, copy } = useCopy();

  const list = useQuery({ queryKey: ['servers'], queryFn: () => api.servers.list() });
  const create = useMutation({
    mutationFn: () => api.servers.create({ name, host, port: Number(port) || 4600 }),
    onSuccess: (res) => {
      setRevealed({ token: res.token, tokenSha256: res.tokenSha256, agentCommand: res.agentCommand });
      setOpen(false);
      setName('');
      setHost('');
      setPort('4600');
      qc.invalidateQueries({ queryKey: ['servers'] });
      toast('Server registered — copy the agent token now', 'success');
    },
    onError: () => toast('Could not register the server', 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.servers.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      toast('Server removed', 'success');
    },
    onError: () => toast('Could not remove the server', 'error'),
  });
  const test = useMutation({
    mutationFn: (id: number) => api.servers.test(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      toast('Agent reachable — marked online', 'success');
    },
    onError: () => toast('Agent unreachable', 'error'),
  });

  return (
    <div className="max-w-3xl">
      <PageHeader
        icon={<ServerIcon size={18} />}
        title="Servers"
        subtitle="Remote hosts running the NineDeploy agent — deploy services off-box."
      />

      {revealed && (
        <Card className="mb-5 border-amber-500/30">
          <div className="p-5 space-y-3">
            <p className="text-xs font-medium text-amber-200">
              Copy these now — the agent token is shown only once. Run this on the target host:
            </p>
            <code className="block break-all rounded bg-black/40 px-3 py-2 font-mono text-[11px] text-amber-100">
              NINEDEPLOY_AGENT=1 NINEDEPLOY_AGENT_TOKEN={revealed.tokenSha256} NINEDEPLOY_AGENT_PORT=4600 node apps/server/dist/server.js
            </code>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void copy(`NINEDEPLOY_AGENT=1 NINEDEPLOY_AGENT_TOKEN=${revealed.tokenSha256} node apps/server/dist/server.js`)}>
                {copied ? 'Copied!' : 'Copy command'}
              </Button>
              <button onClick={() => setRevealed(null)} className="text-xs text-amber-200/70 hover:underline">
                Done
              </button>
            </div>
          </div>
        </Card>
      )}

      {open && (
        <Card className="mb-5 p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && host.trim()) create.mutate();
            }}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="edge-1" className="h-9" /></Field>
            <Field label="Host"><Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.5" className="h-9 font-mono text-xs" /></Field>
            <Field label="Agent port"><Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" className="h-9 font-mono text-xs" /></Field>
            <div className="sm:col-span-3 flex gap-2">
              <Button type="submit" size="sm" disabled={!name.trim() || !host.trim() || create.isPending}>
                {create.isPending ? 'Registering…' : 'Register server'}
              </Button>
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">Cancel</button>
            </div>
          </form>
        </Card>
      )}

      <div className="mb-4 flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} /> {open ? 'Close' : 'Add server'}
        </Button>
      </div>

      {list.isLoading ? (
        <Card className="p-5"><Skeleton className="h-10 w-full" /></Card>
      ) : list.isError ? (
        <ErrorCard title="Couldn't load servers" error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data || list.data.length === 0 ? (
        <Card><EmptyState icon={<HardDrive size={26} />} title="No remote servers" hint="Everything deploys on this host. Register a server to deploy there." /></Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Server</th>
                <th className="px-5 py-3 font-medium">Address</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-5 py-3 font-medium text-slate-200">{s.name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-400">{s.host}:{s.port}</td>
                  <td className="px-5 py-3">
                    <span className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset',
                      s.status === 'online' ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/20' : s.status === 'error' ? 'bg-rose-500/15 text-rose-300 ring-rose-500/20' : 'bg-slate-500/15 text-slate-400 ring-slate-500/20',
                    )}>
                      {s.status}
                      {s.lastSeenAt && <span className="text-[10px] opacity-70">· {formatRelative(s.lastSeenAt)}</span>}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => test.mutate(s.id)} className="text-xs text-slate-500 hover:text-indigo-300" title="Test connectivity">
                        test
                      </button>
                      <button onClick={() => setPendingDelete({ id: s.id, name: s.name })} className="text-slate-600 transition hover:text-rose-400" title="Remove server">
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
      <p className="mt-3 text-xs text-slate-600">
        The agent runs the same binary with <code className="text-slate-400">NINEDEPLOY_AGENT=1</code> and only executes a fixed set of typed docker/git operations — never raw commands.
      </p>

      <ConfirmDialog
        open={pendingDelete != null}
        title="Remove server"
        message={`Remove "${pendingDelete?.name}"? Services already deployed there keep running but can no longer be managed from here.`}
        confirmLabel="Remove"
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
