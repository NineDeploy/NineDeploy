import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { GitBranch, Plus, Server } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../lib/api.js';
import { Button, Card, EmptyState, Skeleton, StatusBadge } from '../components/ui.js';
import { DeployWizard } from '../components/DeployWizard.js';

export function ServicesList() {
  const [wizard, setWizard] = useState(false);
  const { data: services, isLoading } = useQuery({ queryKey: ['services'], queryFn: () => api.services.list() });

  return (
    <div>
      <div className="mb-7 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
          <p className="mt-1 text-sm text-slate-400">Deploy and manage your applications.</p>
        </div>
        <Button onClick={() => setWizard(true)}>
          <Plus size={16} /> New service
        </Button>
      </div>

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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <Link key={s.id} to={`/services/${s.id}`} className="block">
              <Card interactive className="group h-full p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.04] text-slate-400 ring-1 ring-inset ring-white/10 transition group-hover:text-indigo-300">
                      <Server size={18} />
                    </div>
                    <div>
                      <div className="font-semibold leading-tight text-slate-100 group-hover:text-white">{s.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{s.slug}</div>
                    </div>
                  </div>
                  <StatusBadge status={s.status} />
                </div>

                <div className="mt-5 flex items-center gap-4 text-xs text-slate-500">
                  <span className="font-mono uppercase tracking-wide text-slate-400">{s.type}</span>
                  <span className="flex items-center gap-1">
                    <GitBranch size={12} /> {s.branch}
                  </span>
                  {s.port && <span className="font-mono">:{s.port}</span>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
