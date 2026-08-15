import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ExternalLink, Rocket, Search, Sparkles, X } from 'lucide-react';
import type { Template } from '@ninedeploy/sdk';
import { api } from '../lib/api.js';
import { Button, Card, EmptyState, ErrorCard, Input, PageHeader, Skeleton, cn } from '../components/ui.js';
import { DeployWizard } from '../components/DeployWizard.js';

export function Hub() {
  const list = useQuery({ queryKey: ['templates'], queryFn: () => api.templates.list() });
  // Surface when the registry comes from a custom source (Settings → Hub).
  const settings = useQuery({ queryKey: ['instance-settings'], queryFn: () => api.settings.get(), staleTime: 60_000 });
  const customSource = settings.data?.templatesSource ?? null;
  const [category, setCategory] = useState('All');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [wizardTpl, setWizardTpl] = useState<Template | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>(['All']);
    (list.data ?? []).forEach((t) => set.add(t.category));
    return Array.from(set);
  }, [list.data]);

  const filtered = (list.data ?? []).filter(
    (t) =>
      (category === 'All' || t.category === category) &&
      (t.name.toLowerCase().includes(query.toLowerCase()) || t.tagline.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <div>
      <PageHeader
        icon={<Sparkles size={18} />}
        title="Hub"
        subtitle="One-click apps — deploy in seconds."
        actions={
          customSource ? (
            <span
              className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300 ring-1 ring-inset ring-indigo-500/20"
              title={`Custom registry: ${customSource}`}
            >
              custom registry
            </span>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates…" className="h-9 pl-8" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition',
                category === c ? 'bg-indigo-500 text-white' : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.08]',
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {list.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="p-5"><Skeleton className="h-16 w-full" /></Card>
          ))}
        </div>
      ) : list.isError ? (
        <ErrorCard title="Couldn't load templates" error={list.error} onRetry={() => list.refetch()} />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState icon={<Search size={26} />} title="No templates match" hint={query ? `Nothing matches "${query}" in ${category === 'All' ? 'any category' : category}.` : `No templates in ${category}.`} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <Card key={t.id} interactive className="group cursor-pointer p-5" >
              <button className="w-full text-left" onClick={() => setSelected(t.id)}>
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-2xl ring-1 ring-inset ring-white/10">
                    {t.emoji}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-100">{t.name}</span>
                      {t.featured && <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase text-indigo-300">featured</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{t.tagline}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-400">{t.category}</span>
                  <span className="flex items-center gap-1 text-xs text-indigo-300 opacity-0 transition group-hover:opacity-100">
                    <Rocket size={12} /> Deploy
                  </span>
                </div>
              </button>
            </Card>
          ))}
        </div>
      )}

      {selected && <TemplateDetail id={selected} onClose={() => setSelected(null)} onDeploy={(t) => { setSelected(null); setWizardTpl(t); }} />}
      {wizardTpl && <DeployWizard template={wizardTpl} onClose={() => setWizardTpl(null)} />}
    </div>
  );
}

function TemplateDetail({ id, onClose, onDeploy }: { id: string; onClose: () => void; onDeploy: (t: Template) => void }) {
  const detail = useQuery({ queryKey: ['template', id], queryFn: () => api.templates.get(id) });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="nd-fade w-full max-w-lg overflow-hidden rounded-t-2xl border border-white/10 bg-slate-950 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {detail.isLoading || !detail.data ? (
          <div className="p-6"><Skeleton className="h-20 w-full" /></div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-white/5 p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/[0.05] text-2xl ring-1 ring-inset ring-white/10">{detail.data.emoji}</span>
                <div>
                  <h2 className="text-lg font-semibold">{detail.data.name}</h2>
                  <p className="text-xs text-slate-400">{detail.data.tagline}</p>
                </div>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300"><X size={16} /></button>
            </div>

            <div className="max-h-[50vh] space-y-4 overflow-auto p-5">
              <p className="text-sm leading-relaxed text-slate-300">{detail.data.description}</p>

              {detail.data.requires && (
                <p className="rounded-lg bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-200 ring-1 ring-inset ring-amber-500/20">
                  {detail.data.requires}
                </p>
              )}

              <div className="grid grid-cols-3 gap-3 text-center">
                <Spec label="Image" value={detail.data.image.split('/').pop()!} />
                <Spec label="Port" value={`:${detail.data.port}`} />
                <Spec label="Persist" value={detail.data.volumeMount ? 'Volume' : 'Ephemeral'} />
              </div>

              {detail.data.env && detail.data.env.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Environment</p>
                  <div className="space-y-1">
                    {detail.data.env.map((e) => (
                      <div key={e.key} className="flex items-center justify-between rounded-md bg-black/30 px-2.5 py-1.5 font-mono text-xs">
                        <span className="text-slate-300">{e.key}</span>
                        <span className={cn(e.secret ? 'text-amber-400/80' : 'text-slate-500')}>{e.secret ? '••• secret' : e.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.data.website && (
                <a href={detail.data.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200">
                  <ExternalLink size={12} /> {detail.data.website.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>

            <div className="border-t border-white/5 p-4">
              <Button className="w-full" onClick={() => detail.data && onDeploy(detail.data)} disabled={!detail.data}>
                <Rocket size={16} /> Configure &amp; deploy
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs text-slate-200">{value}</div>
    </div>
  );
}
