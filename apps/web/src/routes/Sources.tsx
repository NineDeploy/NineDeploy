import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Check, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Card, EmptyState, Field, Input, Select, Skeleton, Textarea, cn } from '../components/ui.js';

const TYPES = ['github', 'gitlab', 'gitea', 'custom', 'registry'] as const;
const LABEL: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', gitea: 'Gitea', custom: 'Custom', registry: 'Registry' };

export function Sources() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('github');
  const [token, setToken] = useState('');
  const [deployKey, setDeployKey] = useState('');
  const [registryUsername, setRegistryUsername] = useState('');

  const list = useQuery({ queryKey: ['sources'], queryFn: () => api.sources.list() });
  const create = useMutation({
    mutationFn: () => api.sources.create({ name, type, token: token || undefined, deployKey: deployKey || undefined, registryUsername: type === 'registry' && registryUsername.trim() ? registryUsername.trim() : undefined }),
    onSuccess: () => {
      setOpen(false);
      setName('');
      setToken('');
      setDeployKey('');
      setRegistryUsername('');
      qc.invalidateQueries({ queryKey: ['sources'] });
    },
  });
  const remove = useMutation({ mutationFn: (id: number) => api.sources.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }) });

  return (
    <div>
      <div className="mb-7 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
          <p className="mt-1 text-sm text-slate-400">Credentials for cloning private repositories.</p>
        </div>
        <Button onClick={() => setOpen((v) => !v)}>
          <Plus size={16} /> New source
        </Button>
      </div>

      {open && (
        <Card className="mb-5 p-5 nd-fade">
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (name.trim() && (token.trim() || deployKey.trim())) create.mutate();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="github-personal" required />
              </Field>
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={type === 'registry' ? 'Access token / registry password' : 'Access token (PAT) — for HTTPS'}>
              <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder={type === 'registry' ? 'dckr_pat_… / password' : 'ghp_… / glpat-…'} className="font-mono text-xs" />
            </Field>
            {type === 'registry' && (
              <Field label="Registry username">
                <Input value={registryUsername} onChange={(e) => setRegistryUsername(e.target.value)} placeholder="dockerhub-user" className="font-mono text-xs" />
              </Field>
            )}
            <Field label="…or SSH deploy key (private key) — for git@ URLs">
              <Textarea
                value={deployKey}
                onChange={(e) => setDeployKey(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                rows={4}
                className="font-mono text-[11px]"
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={create.isPending || !name.trim() || (!token.trim() && !deployKey.trim())}>
                {create.isPending ? 'Saving…' : 'Save source'}
              </Button>
            </div>
            <p className="text-xs text-slate-500">Credentials are encrypted at rest and never returned by the API.</p>
          </form>
        </Card>
      )}

      {list.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-1/2" />
            </Card>
          ))}
        </div>
      ) : !list.data || list.data.length === 0 ? (
        <Card>
          <EmptyState icon={<KeyRound size={26} />} title="No sources" hint="Add a GitHub/GitLab token or SSH deploy key to deploy private repos." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((s) => (
            <Card key={s.id} interactive className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.04] text-amber-300 ring-1 ring-inset ring-white/10">
                    <KeyRound size={18} />
                  </div>
                  <div>
                    <div className="font-semibold leading-tight">{s.name}</div>
                    <div className="text-[11px] text-slate-500">{LABEL[s.type] ?? s.type}</div>
                  </div>
                </div>
                <button onClick={() => remove.mutate(s.id)} className="text-slate-600 transition hover:text-rose-400">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Tag ok={s.hasToken} label="Token" />
                <Tag ok={s.hasDeployKey} label="Deploy key" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Tag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ring-1 ring-inset',
        ok ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20' : 'bg-white/[0.03] text-slate-600 ring-white/5',
      )}
    >
      {ok ? <Check size={11} /> : <ShieldCheck size={11} />} {label}
    </span>
  );
}
