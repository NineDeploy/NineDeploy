import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Lock,
  Plus,
  Radio,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Zap,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../components/Toast.js';
import { Button, Card, CardBody, Input, cn } from '../../components/ui.js';

export function FirewallSection() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [port, setPort] = useState('');
  const [proto, setProto] = useState<'tcp' | 'udp' | 'any'>('tcp');
  const [action, setAction] = useState<'allow' | 'deny' | 'limit'>('allow');
  const [fromIp, setFromIp] = useState('');
  const [comment, setComment] = useState('');

  const statusQuery = useQuery({
    queryKey: ['firewall-status'],
    queryFn: () => api.firewall.status(),
  });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => api.firewall.toggle(enabled),
    onSuccess: (data, enabled) => {
      qc.setQueryData(['firewall-status'], data.status);
      toast(enabled ? 'Host firewall (UFW) enabled' : 'Host firewall (UFW) disabled', 'success');
    },
    onError: (err: any) => toast(err?.message || 'Could not toggle firewall', 'error'),
  });

  const applyRecommended = useMutation({
    mutationFn: () => api.firewall.applyRecommended(),
    onSuccess: (data) => {
      qc.setQueryData(['firewall-status'], data.status);
      toast('Recommended VPS firewall profile applied (22, 80, 443 allowed)', 'success');
    },
    onError: (err: any) => toast(err?.message || 'Failed to apply recommended profile', 'error'),
  });

  const addRuleMutation = useMutation({
    mutationFn: () =>
      api.firewall.addRule({
        port: port.trim(),
        proto,
        action,
        from: fromIp.trim() || undefined,
        comment: comment.trim() || undefined,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['firewall-status'], data.status);
      setPort('');
      setFromIp('');
      setComment('');
      toast('Firewall rule added', 'success');
    },
    onError: (err: any) => toast(err?.message || 'Failed to add rule', 'error'),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id: number) => api.firewall.deleteRule(id),
    onSuccess: (data) => {
      qc.setQueryData(['firewall-status'], data.status);
      toast('Firewall rule removed', 'success');
    },
    onError: (err: any) => toast(err?.message || 'Failed to delete rule', 'error'),
  });

  const status = statusQuery.data;

  return (
    <div className="space-y-6">
      {/* ── Status & Master Switch ────────────────────────────────────────── */}
      <Card>
        <CardBody className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div
                className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1',
                  status?.active
                    ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
                )}
              >
                {status?.active ? <ShieldCheck size={26} /> : <ShieldAlert size={26} />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-100">Host Firewall (UFW)</h3>
                  {status?.installed ? (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                        status.active
                          ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-300 ring-amber-500/20',
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', status.active ? 'bg-emerald-400' : 'bg-amber-400')} />
                      {status.active ? 'Active & Protecting' : 'Inactive'}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-500/10 px-2.5 py-0.5 text-xs font-medium text-slate-400 ring-1 ring-slate-500/20">
                      Not Available
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-400 max-w-xl">
                  Controls Linux kernel packet filtering and inbound port access. When active, all incoming traffic is blocked by default except explicitly permitted ports.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => statusQuery.refetch()}
                disabled={statusQuery.isFetching}
                title="Refresh firewall state"
              >
                <RefreshCw size={14} className={statusQuery.isFetching ? 'animate-spin' : ''} />
              </Button>
              {status?.installed && (
                <Button
                  variant={status.active ? 'ghost' : 'primary'}
                  size="sm"
                  onClick={() => toggleMutation.mutate(!status.active)}
                  disabled={toggleMutation.isPending}
                  className={status.active ? 'text-rose-400 hover:bg-rose-500/10' : ''}
                >
                  {status.active ? 'Disable Firewall' : 'Enable Firewall'}
                </Button>
              )}
            </div>
          </div>

          {/* Quick VPS Hardening Action */}
          {status?.installed && (!status.active || status.rules.length === 0) && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-indigo-500/10 p-3 ring-1 ring-indigo-500/20">
              <div className="flex items-center gap-2 text-xs text-indigo-300">
                <Zap size={14} className="shrink-0 text-indigo-400" />
                <span>
                  <strong>Quick Start:</strong> Protect your VPS with standard hosting rules (allows 22 SSH, 80 HTTP, 443 HTTPS).
                </span>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => applyRecommended.mutate()}
                disabled={applyRecommended.isPending}
              >
                Apply VPS Profile
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Active Rules Table ────────────────────────────────────────────── */}
      <Card>
        <CardBody className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Active Ingress & Port Rules</h4>
              <p className="text-xs text-slate-400">
                Traffic matching these rules is permitted through the host firewall.
              </p>
            </div>
            {status?.rules && status.rules.length > 0 && (
              <span className="font-mono text-xs text-slate-400">{status.rules.length} rule(s)</span>
            )}
          </div>

          {status?.rules && status.rules.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-white/5 bg-slate-950/40">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02] text-slate-400">
                    <th className="px-4 py-2.5 font-medium">#</th>
                    <th className="px-4 py-2.5 font-medium">To / Port</th>
                    <th className="px-4 py-2.5 font-medium">Action</th>
                    <th className="px-4 py-2.5 font-medium">From (Source)</th>
                    <th className="px-4 py-2.5 font-medium">Comment</th>
                    <th className="px-4 py-2.5 text-right font-medium">Manage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono text-slate-300">
                  {status.rules.map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.01]">
                      <td className="px-4 py-2.5 text-slate-500">{r.id}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-200">{r.to}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-bold',
                            r.action.includes('ALLOW')
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-rose-500/10 text-rose-400',
                          )}
                        >
                          {r.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{r.from}</td>
                      <td className="px-4 py-2.5 font-sans text-xs text-slate-400">
                        {r.comment || <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteRuleMutation.mutate(r.id)}
                          disabled={deleteRuleMutation.isPending}
                          className="h-7 w-7 p-0 text-slate-500 hover:text-rose-400"
                          title="Delete rule"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-slate-500">
              No active host firewall rules found.
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Add Firewall Rule ─────────────────────────────────────────────── */}
      <Card>
        <CardBody className="p-6">
          <h4 className="mb-1 text-sm font-semibold text-slate-200">Add Firewall Port Rule</h4>
          <p className="mb-4 text-xs text-slate-400">
            Open a host TCP/UDP port for custom databases, VPNs, or direct access.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (port.trim()) addRuleMutation.mutate();
            }}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Port / Service</label>
              <Input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="e.g. 5432 or 8080"
                required
                className="h-9 font-mono text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Protocol</label>
              <select
                value={proto}
                onChange={(e) => setProto(e.target.value as any)}
                className="h-9 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="any">ANY (TCP+UDP)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Action</label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as any)}
                className="h-9 w-full rounded-lg border border-white/10 bg-slate-900 px-3 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
              >
                <option value="allow">ALLOW (Permit)</option>
                <option value="deny">DENY (Block)</option>
                <option value="limit">LIMIT (Rate limit SSH)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Source IP / CIDR (Optional)</label>
              <Input
                value={fromIp}
                onChange={(e) => setFromIp(e.target.value)}
                placeholder="Anywhere (or 1.2.3.4)"
                className="h-9 font-mono text-xs"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                variant="primary"
                disabled={!port.trim() || addRuleMutation.isPending}
                className="h-9 w-full"
              >
                <Plus size={14} className="mr-1" />
                Add Rule
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {/* ── Multi-Layer Security Architecture Card ────────────────────────── */}
      <Card>
        <CardBody className="p-6">
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-slate-200">
            <Lock size={16} className="text-indigo-400" />
            <span>Multi-Layer Firewall & Security Architecture</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-400">
            <div className="rounded-xl border border-white/5 bg-slate-950/40 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Radio size={14} className="text-emerald-400" />
                <span>1. Host Network (UFW)</span>
              </div>
              <p>
                Controls physical machine network ports (22 SSH, 80 HTTP, 443 HTTPS). Blocks raw port scanning and unauthorized network probing.
              </p>
            </div>

            <div className="rounded-xl border border-white/5 bg-slate-950/40 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Shield size={14} className="text-indigo-400" />
                <span>2. Application WAF (Traefik)</span>
              </div>
              <p>
                Configurable per-domain in <em>Service &rarr; Network &rarr; Security</em>: IP allowlisting (CIDR), Rate Limiting (req/sec), and HTTP Basic Auth.
              </p>
            </div>

            <div className="rounded-xl border border-white/5 bg-slate-950/40 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Zap size={14} className="text-amber-400" />
                <span>3. Zero Trust Tunnels</span>
              </div>
              <p>
                Expose services globally with <strong>0 inbound open ports</strong> via Cloudflare Tunnels (Tunnels tab), bypassing traditional open-port firewalls entirely.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
