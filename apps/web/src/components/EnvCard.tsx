import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { KeyRound, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Card, CardBody, Input, Skeleton, cn } from './ui.js';

// Vault reference examples (escaped so linters don't read them as template placeholders).
const REF_INFISICAL = '\u0024\u007B\u007Binfisical:KEY\u007D\u007D';
const REF_DOPPLER = '\u0024\u007B\u007Bdoppler:KEY\u007D\u007D';

export function EnvCard({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [secret, setSecret] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState('');

  const env = useQuery({ queryKey: ['env', serviceId], queryFn: () => api.env.list(serviceId) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['env', serviceId] });
  const add = useMutation({ mutationFn: () => api.env.create(serviceId, { key, value, isSecret: secret }), onSuccess: invalidate });
  const update = useMutation({ mutationFn: (v: { id: number; key: string; value: string }) => api.env.update(serviceId, v.id, { key: v.key, value: v.value }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => api.env.remove(serviceId, id), onSuccess: invalidate });

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    add.mutate();
    setKey('');
    setValue('');
    setSecret(false);
  };

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <KeyRound size={15} className="text-slate-500" /> Environment
          </div>
          {(env.data?.length ?? 0) > 5 && (
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter keys…"
              className="h-7 w-40 text-xs"
            />
          )}
        </div>
        <p className="mb-2 text-[11px] text-slate-600">
          Values may reference an external secret store and are resolved at deploy time:{' '}
          <code className="rounded bg-white/5 px-1 font-mono text-[10px] text-slate-500">{REF_INFISICAL}</code>{' '}
          / <code className="rounded bg-white/5 px-1 font-mono text-[10px] text-slate-500">{REF_DOPPLER}</code>
        </p>

        <form onSubmit={onAdd} className="space-y-2">
          <div className="flex gap-2">
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="KEY" className="h-9 font-mono text-xs" />
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={secret ? 'secret value' : 'value'}
              type={secret ? 'password' : 'text'}
              className="h-9 font-mono text-xs"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!key.trim() || add.isPending}>
              <Plus size={14} />
            </Button>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} className="accent-indigo-500" />
            <Lock size={11} /> Secret (encrypted, hidden in UI)
          </label>
        </form>

        <div className="mt-3 space-y-1.5">
          {env.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : !env.data || env.data.length === 0 ? (
            <p className="py-2 text-xs text-slate-600">No environment variables.</p>
          ) : (
            env.data
              .filter((v) => !filter || v.key.toLowerCase().includes(filter.toLowerCase()))
              .map((v) => {
              const draft = drafts[v.id] ?? v.value;
              const dirty = draft !== v.value && draft !== '';
              return (
                <div key={v.id} className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-2 py-1.5 ring-1 ring-inset ring-white/5">
                  <div className="w-28 shrink-0">
                    <div className="truncate font-mono text-[11px] font-medium text-slate-200">{v.key}</div>
                    {v.isSecret && <span className="text-[9px] uppercase tracking-wide text-amber-400/80">secret</span>}
                  </div>
                  <Input
                    value={dirty ? draft : v.value}
                    type={v.isSecret ? 'password' : 'text'}
                    placeholder={v.isSecret ? '•••• hidden' : ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [v.id]: e.target.value }))}
                    className="h-7 flex-1 font-mono text-[11px]"
                  />
                  <button type="button"
                    onClick={() => update.mutate({ id: v.id, key: v.key, value: draft })}
                    disabled={!dirty}
                    className={cn('text-slate-600 transition', dirty ? 'hover:text-emerald-400' : 'opacity-30')}
                    title="Save"
                  >
                    <Save size={13} />
                  </button>
                  <button type="button" onClick={() => remove.mutate(v.id)} className="text-slate-600 transition hover:text-rose-400" title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </CardBody>
    </Card>
  );
}
