import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Globe, Lock } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { Card, EmptyState, Skeleton, StatusBadge, cn } from '../components/ui.js';

/** Whole days between now and an ISO expiry timestamp. */
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function Domains() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['domains-all'], queryFn: () => api.domains.all() });
  const toggle = useMutation({
    mutationFn: (d: { id: number; ssl: boolean }) => api.domains.setSsl(d.id, d.ssl),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains-all'] }),
  });

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Globe size={20} className="text-indigo-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Domains</h1>
          <p className="text-sm text-slate-400">Routing map &amp; SSL — where each domain points.</p>
        </div>
      </div>

      {list.isLoading ? (
        <Card className="p-5"><Skeleton className="h-10 w-full" /></Card>
      ) : !list.data || list.data.length === 0 ? (
        <Card><EmptyState icon={<Globe size={26} />} title="No domains" hint="Add a domain to a service to route traffic to it." /></Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Domain</th>
                <th className="px-5 py-3 font-medium">Routes to</th>
                <th className="px-5 py-3 font-medium">Container</th>
                <th className="px-5 py-3 font-medium">SSL</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((d) => (
                <tr key={d.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-5 py-3">
                    <a href={`http${d.ssl ? 's' : ''}://${d.hostname}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-slate-200 hover:text-indigo-300">
                      {d.hostname}
                    </a>
                    {d.path !== '/' && <span className="ml-1 font-mono text-[10px] text-slate-600">{d.path}</span>}
                  </td>
                  <td className="px-5 py-3">
                    {d.serviceName ? (
                      <Link to={`/services/${d.serviceId}`} className="flex items-center gap-1.5 text-slate-300 hover:text-indigo-300">
                        {d.serviceName} <ArrowRight size={11} className="text-slate-600" /> :{d.port ?? '?'}
                      </Link>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 font-mono text-[11px] text-slate-500">{d.container ?? '—'}</td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => toggle.mutate({ id: d.id, ssl: !d.ssl })}
                      className={cn(
                        'relative inline-flex h-5 w-9 items-center rounded-full transition',
                        d.ssl ? 'bg-emerald-500' : 'bg-white/10',
                      )}
                      title={d.ssl ? 'HTTPS on' : 'HTTP only — click to enable HTTPS'}
                    >
                      <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition', d.ssl ? 'translate-x-5' : 'translate-x-1')} />
                    </button>
                    {d.ssl && <Lock size={11} className="ml-1.5 inline text-emerald-400" />}
                    {d.certExpiresAt && (
                      <span
                        className={cn(
                          'ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset',
                          daysUntil(d.certExpiresAt) < 14
                            ? 'bg-amber-500/15 text-amber-300 ring-amber-500/20'
                            : 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20',
                        )}
                        title="Certificate expiry (Let's Encrypt)"
                      >
                        cert {daysUntil(d.certExpiresAt)}d
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3"><StatusBadge status={d.ssl ? 'active' : d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="mt-3 text-xs text-slate-600">HTTPS uses Traefik&apos;s certificate on :443. On a public domain, NineDeploy provisions a Let&apos;s Encrypt cert automatically.</p>
    </div>
  );
}
