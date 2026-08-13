import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Database, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Input, cn } from './ui.js';

const ENGINES = [
  { id: 'postgres', label: 'PostgreSQL', emoji: '🐘', hint: 'Relational · SQL' },
  { id: 'mysql', label: 'MySQL', emoji: '🐬', hint: 'Relational · SQL' },
  { id: 'redis', label: 'Redis', emoji: '⚡', hint: 'Key-value · cache' },
  { id: 'mongo', label: 'MongoDB', emoji: '🍃', hint: 'Document · NoSQL' },
] as const;

const STEPS = ['Engine', 'Details', 'Review'];

export function DatabaseWizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [engine, setEngine] = useState<typeof ENGINES[number]['id'] | null>(null);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');

  const create = useMutation({
    mutationFn: () => api.databases.create({ name, engine: engine!, version: version || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['databases'] });
      onClose();
    },
  });

  const canNext = step === 0 ? !!engine : step === 1 ? !!name.trim() : true;

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) next();
    else create.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div className="nd-fade w-full max-w-lg overflow-hidden rounded-t-2xl border border-white/10 bg-slate-950 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header + stepper */}
        <div className="border-b border-white/5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Database size={18} className="text-emerald-400" /> New database</h2>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300"><X size={16} /></button>
          </div>
          <div className="flex items-center gap-2">
            {STEPS.map((label, i) => (
              <div key={label} className="flex flex-1 items-center gap-2">
                <div className={cn('grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold transition', i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-indigo-500 text-white' : 'bg-white/10 text-slate-500')}>
                  {i < step ? <Check size={12} /> : i + 1}
                </div>
                <span className={cn('text-xs', i === step ? 'text-slate-200' : 'text-slate-500')}>{label}</span>
                {i < STEPS.length - 1 && <div className="h-px flex-1 bg-white/10" />}
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={onSubmit} className="p-5">
          {step === 0 && (
            <div className="grid grid-cols-2 gap-3">
              {ENGINES.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setEngine(e.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border p-3 text-left transition',
                    engine === e.id ? 'border-emerald-500/60 bg-emerald-500/[0.06]' : 'border-white/10 bg-white/[0.02] hover:border-white/20',
                  )}
                >
                  <span className="text-2xl">{e.emoji}</span>
                  <span>
                    <span className="block text-sm font-medium text-slate-100">{e.label}</span>
                    <span className="block text-[10px] text-slate-500">{e.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">Name</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-database" autoFocus />
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">Version (optional)</span>
                <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 16 (default if empty)" />
              </div>
              <p className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-slate-500">
                A persistent volume, auto-generated credentials and a connection string will be created automatically.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-2 text-sm">
              <Row label="Engine" value={`${ENGINES.find((e) => e.id === engine)?.emoji ?? ''} ${ENGINES.find((e) => e.id === engine)?.label ?? ''}`} />
              <Row label="Name" value={name} />
              <Row label="Version" value={version || 'default'} />
              <Row label="Volume" value="persistent (nd-db-…-data)" />
              <Row label="Credentials" value="auto-generated, encrypted" />
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={back} className={cn(step === 0 && 'invisible')}>
              <ArrowLeft size={14} /> Back
            </Button>
            <Button type="submit" disabled={!canNext || create.isPending}>
              {step === STEPS.length - 1 ? (create.isPending ? 'Creating…' : 'Create database') : <>Continue <ArrowRight size={14} /></>}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="font-medium text-slate-200">{value}</span>
    </div>
  );
}
