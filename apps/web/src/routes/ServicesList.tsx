import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Cpu, GitBranch, HardDrive, MemoryStick, Plus, Search, Server } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { useProjectScope } from '../lib/projects.js';
import { Button, Card, EmptyState, ErrorCard, Input, PageHeader, Skeleton, StatusBadge } from '../components/ui.js';
import { DeployWizard } from '../components/DeployWizard.js';

export function ServicesList() {
  const [wizard, setWizard] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped' | 'errored'>('all');
  const { selectedId } = useProjectScope();
  const { data: services, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['services', selectedId],
    queryFn: () => api.services.list(selectedId != null ? `?projectId=${selectedId}` : ''),
  });

  const snapshot = useQuery({
    queryKey: ['live-stats-snapshot'],
    queryFn: () => api.stats.snapshot(),
    refetchInterval: 3000,
  });

  const filteredServices = useMemo(() => {
    if (!services) return [];
    return services.filter((s) => {
      const matchStatus = statusFilter === 'all' || s.status === statusFilter;
      if (!matchStatus) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (s.name ?? '').toLowerCase().includes(q) ||
        (s.slug ?? '').toLowerCase().includes(q) ||
        (s.branch ?? '').toLowerCase().includes(q) ||
        (s.type ?? '').toLowerCase().includes(q)
      );
    });
  }, [services, searchQuery, statusFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Server size={18} />}
        title="Services"
        subtitle="Deploy and manage your applications."
        actions={
          <Button onClick={() => setWizard(true)}>
            <Plus size={16} /> New service
          </Button>
        }
      />

      {wizard && <DeployWizard onClose={() => setWizard(false)} />}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-3 h-3 w-2/3" />
              <Skeleton className="mt-4 h-6 w-24" />
            </Card>
          ))}
        </div>
      ) : isError ? (
        <ErrorCard title="Couldn't load services" error={error} onRetry={() => void refetch()} />
      ) : !services || services.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Server size={26} />}
            title="No services yet"
            hint="Connect a repository to deploy your first application in seconds."
            action={
              <Button onClick={() => setWizard(true)}>
                <Plus size={16} /> Create service
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Search and status filter bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-xs flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input
                placeholder="Search services..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {(['all', 'running', 'stopped', 'errored'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition ${
                    statusFilter === st
                      ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/30'
                      : 'bg-white/[0.03] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {filteredServices.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Server size={24} />}
                title="No matching services"
                hint="Try searching with a different keyword or resetting your filter."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                    }}
                  >
                    Reset filters
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredServices.map((s) => {
                const liveStat = snapshot.data?.containers.find((c) => c.refId === s.id && c.kind === 'service');
                const isRunning = s.status === 'running';

                return (
                  <Link key={s.id} to={`/services/${s.id}`} className="block">
                    <Card interactive className="group h-full p-5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-slate-400 ring-1 ring-inset ring-white/10 transition group-hover:text-indigo-300">
                              <Server size={18} />
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold leading-tight text-slate-100 group-hover:text-white truncate">{s.name}</div>
                              <div className="font-mono text-[11px] text-slate-500 truncate">{s.slug}</div>
                            </div>
                          </div>
                          <StatusBadge status={s.status} />
                        </div>

                        {/* Live CPU & RAM Telemetry Badges */}
                        {isRunning && (
                          <div className="mt-3.5 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-500/20">
                              <Cpu size={11} className="text-indigo-400" />
                              {liveStat ? `${liveStat.cpuPct.toFixed(1)}%` : '0.0%'}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
                              <MemoryStick size={11} className="text-emerald-400" />
                              {liveStat ? `${liveStat.memMb.toFixed(1)} MiB` : '0.0 MiB'}
                            </span>
                            {s.volumeMount && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300 ring-1 ring-inset ring-amber-500/20" title={`Volume mounted at ${s.volumeMount}`}>
                                <HardDrive size={11} className="text-amber-400" />
                                {s.volumeMount}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-xs text-slate-500">
                        <div className="flex items-center gap-3">
                          <span className="font-mono uppercase tracking-wide text-slate-400 text-[10px]">{s.type}</span>
                          <span className="flex items-center gap-1 font-mono text-[11px]">
                            <GitBranch size={11} /> {s.branch}
                          </span>
                        </div>
                        {s.publishedPort ? (
                          <span className="font-mono text-emerald-400 font-semibold">:{s.publishedPort}</span>
                        ) : s.port ? (
                          <span className="font-mono">:{s.port}</span>
                        ) : null}
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
