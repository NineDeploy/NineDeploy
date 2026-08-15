import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Globe, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useToast } from '../../components/Toast.js';
import { Button, Card, CardBody, Input, Skeleton, cn } from '../../components/ui.js';

/** Custom domains attached to one service. */
export function NetworkTab({ serviceId }: { serviceId: number }) {
  return (
    <div className="mt-5 max-w-3xl space-y-5">
      <DomainsCard serviceId={serviceId} />
    </div>
  );
}

// ── Domains ───────────────────────────────────────────────────────────────
function DomainsCard({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [hostname, setHostname] = useState('');

  const domains = useQuery({ queryKey: ['domains', serviceId], queryFn: () => api.domains.list(serviceId) });
  const add = useMutation({
    mutationFn: () => api.domains.create(serviceId, { hostname }),
    onSuccess: () => {
      setHostname('');
      qc.invalidateQueries({ queryKey: ['domains', serviceId] });
    },
    onError: () => toast('Could not add the domain', 'error'),
  });
  const remove = useMutation({
    mutationFn: (domainId: number) => api.domains.remove(serviceId, domainId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains', serviceId] }),
    onError: () => toast('Could not remove the domain', 'error'),
  });
  const toggleSsl = useMutation({
    mutationFn: (d: { id: number; ssl: boolean }) => api.domains.setSsl(d.id, !d.ssl),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains', serviceId] }),
    onError: () => toast('Could not toggle SSL', 'error'),
  });
  const toggleWww = useMutation({
    mutationFn: (d: { id: number; redirectWww: boolean }) =>
      api.domains.update(serviceId, d.id, { redirectWww: !d.redirectWww }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains', serviceId] }),
    onError: () => toast('Could not toggle the www redirect', 'error'),
  });

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
          <Globe size={15} className="text-slate-500" /> Domains
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (hostname.trim()) add.mutate();
          }}
          className="flex gap-2"
        >
          <Input
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="app.example.com"
            className="h-9"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!hostname.trim() || add.isPending}>
            <Plus size={14} /> Add
          </Button>
        </form>

        <div className="mt-3 space-y-1.5">
          {domains.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : !domains.data || domains.data.length === 0 ? (
            <p className="py-2 text-xs text-slate-600">No domains attached.</p>
          ) : (
            domains.data.map((d) => (
              <div
                key={d.id}
                className="group flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-inset ring-white/5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <a
                    href={`${d.ssl ? 'https' : 'http'}://${d.hostname}${d.path}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 truncate font-mono text-xs text-slate-300 hover:text-indigo-300"
                  >
                    {d.hostname}
                    {d.path !== '/' && <span className="text-slate-500">{d.path}</span>}
                    <ExternalLink size={11} className="shrink-0 opacity-0 transition group-hover:opacity-100" />
                  </a>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => toggleSsl.mutate({ id: d.id, ssl: d.ssl })}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset transition',
                      d.ssl
                        ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/20 hover:bg-emerald-500/25'
                        : 'bg-slate-500/15 text-slate-400 ring-slate-500/20 hover:bg-slate-500/25',
                    )}
                    title={d.ssl ? 'HTTPS on — click to disable' : 'HTTPS off — click to issue a certificate'}
                  >
                    {d.ssl ? 'HTTPS' : 'HTTP'}
                  </button>
                  <button
                    onClick={() => toggleWww.mutate({ id: d.id, redirectWww: d.redirectWww })}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset transition',
                      d.redirectWww
                        ? 'bg-sky-500/15 text-sky-300 ring-sky-500/20 hover:bg-sky-500/25'
                        : 'bg-slate-500/15 text-slate-400 ring-slate-500/20 hover:bg-slate-500/25',
                    )}
                    title={d.redirectWww ? 'www→apex redirect on — click to disable' : 'Redirect www. to the apex host — click to enable'}
                  >
                    www
                  </button>
                  <button
                    onClick={() => remove.mutate(d.id)}
                    className="text-slate-600 transition hover:text-rose-400"
                    title="Remove domain"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardBody>
    </Card>
  );
}
