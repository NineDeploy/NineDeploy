import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CheckCircle2, Copy, HardDrive, Plus, Radio, Server as ServerIcon, Sparkles, Trash2, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.js';
import { Button, Card, ConfirmDialog, EmptyState, ErrorCard, Field, Input, PageHeader, Skeleton, cn } from '../components/ui.js';
import { formatRelative, useCopy } from '../lib/format.js';

/**
 * Remote server registry (admin). Supports zero-touch auto-discovery (edge agents
 * announce to master on boot) with 1-click admin approval, or manual token pairing.
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
  const { copied: autoCopied, copy: autoCopy } = useCopy();

  const [cmdTab, setCmdTab] = useState<'docker' | 'npx'>('docker');

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
    mutationFn: (id: number) => api.servers.remove(id, { force: true }),
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
  const approve = useMutation({
    mutationFn: (id: number) => api.servers.approve(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      toast('Server approved and connected to cluster', 'success');
    },
    onError: (err) => toast(`Approval failed: ${err instanceof Error ? err.message : 'unreachable'}`, 'error'),
  });
  const reject = useMutation({
    mutationFn: (id: number) => api.servers.reject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      toast('Server rejected', 'success');
    },
    onError: () => toast('Could not reject server', 'error'),
  });

  const pendingServers = list.data?.filter((s) => s.status === 'pending') ?? [];
  const registeredServers = list.data?.filter((s) => s.status !== 'pending') ?? [];

  const masterOrigin = window.location.origin;
  const autoJoinCommand = `docker run -d --name ninedeploy-agent --restart unless-stopped -p 4600:4600 -v /var/run/docker.sock:/var/run/docker.sock -e NINEDEPLOY_AGENT=1 -e NINEDEPLOY_MASTER_URL=${masterOrigin} ghcr.io/ninedeploy/server:latest`;

  const dockerCommand = revealed
    ? `docker run -d --name ninedeploy-agent --restart unless-stopped -p 4600:4600 -v /var/run/docker.sock:/var/run/docker.sock -e NINEDEPLOY_AGENT=1 -e NINEDEPLOY_AGENT_TOKEN=${revealed.tokenSha256} -e NINEDEPLOY_AGENT_PORT=4600 ghcr.io/ninedeploy/server:latest`
    : '';
  const npxCommand = revealed
    ? `NINEDEPLOY_AGENT=1 NINEDEPLOY_AGENT_TOKEN=${revealed.tokenSha256} NINEDEPLOY_AGENT_PORT=4600 npx -y @ninedeploy/server`
    : '';
  const activeCommand = cmdTab === 'docker' ? dockerCommand : npxCommand;

  return (
    <div className="max-w-3xl">
      <PageHeader
        icon={<ServerIcon size={18} />}
        title="Servers"
        subtitle="Remote hosts running the NineDeploy agent — deploy services across your cluster."
      />

      {/* Auto-Join Quick Instructions Banner */}
      <Card className="mb-6 border-indigo-500/20 bg-indigo-500/[0.03]">
        <div className="p-5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="text-indigo-400" size={16} />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                Zero-Touch Auto-Join Command
              </h3>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void autoCopy(autoJoinCommand)}
              className="text-xs h-7"
            >
              <Copy size={12} className="mr-1" />
              {autoCopied ? 'Copied Auto-Join Command!' : 'Copy Auto-Join Command'}
            </Button>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Run this single command on any remote VPS / edge server. It will automatically announce itself to this NineDeploy instance and show up below for 1-click approval:
          </p>
          <code className="block break-all rounded-lg bg-black/40 p-3 font-mono text-[11px] text-indigo-200/90 ring-1 ring-white/5">
            {autoJoinCommand}
          </code>
        </div>
      </Card>

      {/* Discovery & Pending Approval Section */}
      {pendingServers.length > 0 && (
        <Card className="mb-6 border-amber-500/40 bg-amber-500/[0.04]">
          <div className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Radio className="text-amber-400 animate-pulse" size={18} />
              <h3 className="text-sm font-semibold text-amber-200">
                Discovered Nodes Pending Approval ({pendingServers.length})
              </h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              The following remote servers announced themselves and are requesting to join the cluster. Verify the host address and approve to enable deployments:
            </p>
            <div className="space-y-3">
              {pendingServers.map((s) => (
                <div key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-slate-900/80 p-3.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-100">{s.name}</span>
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/20">
                        Pending Approval
                      </span>
                    </div>
                    <p className="font-mono text-xs text-slate-400 mt-0.5">
                      {s.host}:{s.port}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => approve.mutate(s.id)}
                      disabled={approve.isPending}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white"
                    >
                      <CheckCircle2 size={14} className="mr-1" />
                      {approve.isPending ? 'Verifying…' : 'Approve & Connect'}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => reject.mutate(s.id)}
                      disabled={reject.isPending}
                    >
                      <XCircle size={14} className="mr-1" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {revealed && (
        <Card className="mb-5 border-amber-500/30">
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-amber-200">
                Copy these now — the agent token is shown only once. Run this on the target host:
              </p>
              <div className="flex rounded-lg bg-black/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setCmdTab('docker')}
                  className={cn('rounded px-2.5 py-1 transition', cmdTab === 'docker' ? 'bg-indigo-500 text-white font-medium' : 'text-slate-400 hover:text-slate-200')}
                >
                  Docker (Recommended)
                </button>
                <button
                  type="button"
                  onClick={() => setCmdTab('npx')}
                  className={cn('rounded px-2.5 py-1 transition', cmdTab === 'npx' ? 'bg-indigo-500 text-white font-medium' : 'text-slate-400 hover:text-slate-200')}
                >
                  NPX / Node
                </button>
              </div>
            </div>

            <code className="block break-all rounded bg-black/40 p-3 font-mono text-[11px] text-amber-100 ring-1 ring-white/5">
              {activeCommand}
            </code>

            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void copy(activeCommand)}>
                {copied ? 'Copied!' : 'Copy command'}
              </Button>
              <button type="button" onClick={() => setRevealed(null)} className="text-xs text-amber-200/70 hover:underline">
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
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="edge-1" autoComplete="off" spellCheck={false} className="h-9" /></Field>
            <Field label="Host"><Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.5" autoComplete="off" spellCheck={false} className="h-9 font-mono text-xs" /></Field>
            <Field label="Agent port"><Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" autoComplete="off" className="h-9 font-mono text-xs" /></Field>
            <div className="sm:col-span-3 flex gap-2">
              <Button type="submit" size="sm" disabled={!name.trim() || !host.trim() || create.isPending}>
                {create.isPending ? 'Registering…' : 'Register server'}
              </Button>
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">Cancel</button>
            </div>
          </form>
        </Card>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Connected Servers ({registeredServers.length})</h2>
        <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
          <Plus size={14} /> {open ? 'Close' : 'Add server'}
        </Button>
      </div>

      {list.isLoading ? (
        <Card className="p-5"><Skeleton className="h-10 w-full" /></Card>
      ) : list.isError ? (
        <ErrorCard title="Couldn't load servers" error={list.error} onRetry={() => list.refetch()} />
      ) : registeredServers.length === 0 ? (
        <Card><EmptyState icon={<HardDrive size={26} />} title="No remote servers" hint="Everything deploys on this host. Run the auto-join command on an edge server to deploy there." /></Card>
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
              {registeredServers.map((s) => (
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
                      <button type="button" onClick={() => test.mutate(s.id)} className="text-xs text-slate-500 hover:text-indigo-300" title="Test connectivity">
                        test
                      </button>
                      <button type="button" onClick={() => setPendingDelete({ id: s.id, name: s.name })} className="text-slate-600 transition hover:text-rose-400" title="Remove server">
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
