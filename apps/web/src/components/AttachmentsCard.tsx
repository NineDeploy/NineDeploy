import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Database, Link2, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Card, CardBody, Input, Select, Skeleton, StatusBadge } from './ui.js';

function aliasFor(engine: string | undefined): string {
  return engine === 'redis' ? 'REDIS_URL' : 'DATABASE_URL';
}

export function AttachmentsCard({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const [dbId, setDbId] = useState('');
  const [alias, setAlias] = useState('');

  const attachments = useQuery({ queryKey: ['attachments', serviceId], queryFn: () => api.attachments.list(serviceId) });
  const databases = useQuery({ queryKey: ['databases'], queryFn: () => api.databases.list() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['attachments', serviceId] });
  const attach = useMutation({
    mutationFn: () => api.attachments.create(serviceId, { databaseId: Number(dbId), envAlias: alias || undefined }),
    onSuccess: () => {
      setDbId('');
      setAlias('');
      invalidate();
    },
  });
  const detach = useMutation({ mutationFn: (id: number) => api.attachments.remove(serviceId, id), onSuccess: invalidate });

  const available = (databases.data ?? []).filter((d) => d.status === 'running');

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
          <Link2 size={15} className="text-slate-500" /> Databases
        </div>

        {available.length > 0 && (
          <div className="mb-3 flex gap-2">
            <Select value={dbId} onChange={(e) => setDbId(e.target.value)} className="h-9 flex-1 text-xs">
              <option value="">Select database…</option>
              {available.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.engine})
                </option>
              ))}
            </Select>
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder={dbId ? aliasFor(available.find((d) => d.id === Number(dbId))?.engine) : 'ALIAS'}
              className="h-28 w-32 shrink-0 font-mono text-xs"
            />
            <Button size="sm" variant="secondary" disabled={!dbId || attach.isPending} onClick={() => attach.mutate()}>
              Attach
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          {attachments.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : !attachments.data || attachments.data.length === 0 ? (
            <p className="py-2 text-xs text-slate-600">No databases attached.</p>
          ) : (
            attachments.data.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-inset ring-white/5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Database size={13} className="shrink-0 text-indigo-400" />
                  <span className="truncate text-xs text-slate-300">{a.database?.name ?? 'database'}</span>
                  {a.database && <StatusBadge status={a.database.status} />}
                  <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300/80">{a.envAlias}</code>
                </div>
                <button onClick={() => detach.mutate(a.id)} className="text-slate-600 transition hover:text-rose-400" title="Detach">
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </CardBody>
    </Card>
  );
}
