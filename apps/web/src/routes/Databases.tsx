import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Check, Copy, Database, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Card, EmptyState, Field, Input, Select, Skeleton, StatusBadge, cn } from '../components/ui.js';

const ENGINES = ['postgres', 'mysql', 'redis', 'mongo'] as const;
const ENGINE_LABEL: Record<string, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', redis: 'Redis', mongo: 'MongoDB' };

export function Databases() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [engine, setEngine] = useState<(typeof ENGINES)[number]>('postgres');
  const [version, setVersion] = useState('');
  const [copied, setCopied] = useState<number | null>(null);

  const list = useQuery({ queryKey: ['databases'], queryFn: () => api.databases.list() });
  const create = useMutation({
    mutationFn: () => api.databases.create({ name, engine, version: version || undefined }),
    onSuccess: () => {
      setOpen(false);
      setName('');
      setVersion('');
      qc.invalidateQueries({ queryKey: ['databases'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.databases.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['databases'] }),
  });

  const copy = async (id: number, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* blocked */
    }
  };

  return (
    <div>
      <div className="mb-7 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Databases</h1>
          <p className="mt-1 text-sm text-slate-400">Managed databases with persistent storage.</p>
        </div>
        <Button onClick={() => setOpen((v) => !v)}>
          <Plus size={16} /> New database
        </Button>
      </div>

      {open && (
        <Card className="mb-5 p-5 nd-fade">
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
            className="grid grid-cols-1 gap-4 sm:grid-cols-4"
          >
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-db" required />
            </Field>
            <Field label="Engine">
              <Select value={engine} onChange={(e) => setEngine(e.target.value as (typeof ENGINES)[number])}>
                {ENGINES.map((e) => (
                  <option key={e} value={e}>
                    {ENGINE_LABEL[e]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Version (optional)">
              <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="16" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={create.isPending || !name.trim()}>
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {list.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-3 h-3 w-2/3" />
            </Card>
          ))}
        </div>
      ) : !list.data || list.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Database size={26} />}
            title="No databases"
            hint="Spin up a managed Postgres, MySQL, Redis or MongoDB instance."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((d) => (
            <Card key={d.id} interactive className="flex h-full flex-col p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.04] text-indigo-300 ring-1 ring-inset ring-white/10">
                    <Database size={18} />
                  </div>
                  <div>
                    <div className="font-semibold leading-tight">{d.name}</div>
                    <div className="font-mono text-[11px] text-slate-500">{ENGINE_LABEL[d.engine] ?? d.engine}{d.version ? ` ${d.version}` : ''}</div>
                  </div>
                </div>
                <StatusBadge status={d.status} />
              </div>

              <div className="mt-4 flex-1">
                {d.connectionString ? (
                  <button
                    onClick={() => copy(d.id, d.connectionString!)}
                    className="group flex w-full items-center gap-2 rounded-lg bg-black/30 px-2.5 py-2 text-left ring-1 ring-inset ring-white/5 hover:ring-white/15"
                    title="Copy connection string"
                  >
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-emerald-300/90">
                      {d.connectionString}
                    </code>
                    {copied === d.id ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} className="shrink-0 text-slate-500" />}
                  </button>
                ) : (
                  <div className="rounded-lg bg-black/20 px-2.5 py-2 text-[11px] text-slate-600">Not running</div>
                )}
                <div className="mt-2 font-mono text-[11px] text-slate-600">
                  {d.host ? `${d.host}:${d.port}` : '—'} · user {d.username ?? '—'}{d.database ? ` · db ${d.database}` : ''}
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => remove.mutate(d.id)}
                  className={cn('flex items-center gap-1 text-xs text-slate-600 transition hover:text-rose-400')}
                >
                  <Trash2 size={12} /> Remove
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
