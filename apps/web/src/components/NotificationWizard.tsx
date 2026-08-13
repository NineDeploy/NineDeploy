import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Bell, Check, ExternalLink, MessageCircle,
  Plug, Send, Webhook, X, Zap,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from './Toast.js';
import { Button, Input, cn } from './ui.js';

const STEPS = ['Channel', 'Connect', 'Events', 'Test'];
const TYPES = [
  { id: 'telegram', label: 'Telegram', emoji: '✈️', color: 'from-sky-500 to-blue-600', icon: MessageCircle },
  { id: 'discord', label: 'Discord', emoji: '🎮', color: 'from-indigo-500 to-purple-600', icon: Plug },
  { id: 'webhook', label: 'Webhook', emoji: '🔗', color: 'from-amber-500 to-orange-600', icon: Webhook },
] as const;

const EVENT_GROUPS = [
  { id: 'deploy', label: 'Deployments', emoji: '🚀', desc: 'Deploy, rollback, build logs' },
  { id: 'service', label: 'Services', emoji: '🖥️', desc: 'Create, delete, stop, start' },
  { id: 'database', label: 'Databases', emoji: '🗄️', desc: 'Create, delete, backup' },
  { id: 'domain', label: 'Domains', emoji: '🌐', desc: 'Add, SSL toggle' },
  { id: 'backup', label: 'Backups', emoji: '💾', desc: 'Create, restore' },
  { id: 'user', label: 'Users', emoji: '👤', desc: 'Register, role change' },
];

export function NotificationWizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState(0);

  // State
  const [type, setType] = useState<typeof TYPES[number]['id'] | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set(['deploy', 'service']));
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<'ok' | 'fail' | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.notifications.createChannel({
        name: name || `${type} channel`,
        type: type!,
        target,
        eventFilter: Array.from(selectedEvents).join(','),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notif-channels'] });
      toast('Notification channel created!', 'success');
      onClose();
    },
  });

  const canNext = step === 0 ? !!type : step === 1 ? !!target.trim() : true;
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const toggleEvent = (id: string) =>
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const doTest = async () => {
    setTesting(true);
    setTested(null);
    // Create the channel first, then test it
    try {
      const ch = await api.notifications.createChannel({
        name: name || `${type} channel`,
        type: type!,
        target,
        eventFilter: Array.from(selectedEvents).join(','),
      });
      await api.notifications.testChannel(ch.id);
      setTested('ok');
    } catch {
      setTested('fail');
    } finally {
      setTesting(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) { if (canNext) next(); }
    else if (tested === 'ok') { create.mutate(); }
    else { doTest(); }
  };

  const selectedType = TYPES.find((t) => t.id === type);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div className="nd-fade flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-slate-950 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header + stepper */}
        <div className="border-b border-white/5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Bell size={18} className="text-indigo-400" /> New Notification
            </h2>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300"><X size={16} /></button>
          </div>
          {/* Stepper */}
          <div className="flex items-center gap-2">
            {STEPS.map((label, i) => (
              <div key={label} className="flex flex-1 items-center gap-2">
                <div className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition', i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-indigo-500 text-white' : 'bg-white/10 text-slate-500')}>
                  {i < step ? <Check size={12} /> : i + 1}
                </div>
                <span className={cn('truncate text-[11px]', i === step ? 'text-slate-200' : 'text-slate-500')}>{label}</span>
                {i < STEPS.length - 1 && <div className={cn('h-px flex-1 transition', i < step ? 'bg-emerald-500/50' : 'bg-white/10')} />}
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex-1 overflow-auto p-5">
          {/* Step 1: Choose type — big visual cards */}
          {step === 0 && (
            <div>
              <p className="mb-4 text-sm text-slate-400">Where do you want to receive notifications?</p>
              <div className="space-y-2.5">
                {TYPES.map((t) => {
                  const Icon = t.icon;
                  const active = type === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => { setType(t.id); setName(''); setTarget(''); }}
                      className={cn('group flex w-full items-center gap-4 rounded-xl border p-4 text-left transition', active ? 'border-indigo-500/60 bg-indigo-500/[0.06]' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]')}>
                      <div className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-lg', t.color)}>
                        <Icon size={22} />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-slate-100">{t.label}</div>
                        <div className="text-xs text-slate-500">{t.id === 'telegram' ? 'Get messages via Telegram bot' : t.id === 'discord' ? 'Send to a Discord channel' : 'POST to any URL'}</div>
                      </div>
                      {active && <Check size={18} className="text-indigo-400" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 2: Connect — type-specific guided setup */}
          {step === 1 && type && (
            <div className="space-y-4">
              {type === 'telegram' && (
                <>
                  <div className="rounded-xl bg-sky-500/[0.06] p-4 ring-1 ring-inset ring-sky-500/20">
                    <p className="mb-2 text-sm font-medium text-sky-200">Step 1: Create a Telegram bot</p>
                    <p className="text-xs text-slate-400">Open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">@BotFather</a> in Telegram and send:</p>
                    <code className="mt-1.5 block rounded bg-black/30 px-2 py-1 font-mono text-xs text-sky-300">/newbot</code>
                    <p className="mt-2 text-xs text-slate-400">Follow the prompts, then copy the <strong className="text-slate-300">bot token</strong>.</p>
                  </div>
                  <div className="rounded-xl bg-sky-500/[0.06] p-4 ring-1 ring-inset ring-sky-500/20">
                    <p className="mb-2 text-sm font-medium text-sky-200">Step 2: Get your Chat ID</p>
                    <p className="text-xs text-slate-400">Send any message to your new bot, then visit:</p>
                    <a href="https://api.telegram.org/bot<TOKEN>/getUpdates" target="_blank" rel="noreferrer" className="mt-1.5 flex items-center gap-1 text-xs text-sky-400 hover:underline">
                      api.telegram.org/bot&lt;TOKEN&gt;/getUpdates <ExternalLink size={10} />
                    </a>
                    <p className="mt-1.5 text-xs text-slate-400">Find <code className="text-sky-300">"chat":{"{"}"id": 123456789{"}"}</code></p>
                  </div>
                  <div>
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">Bot token : Chat ID</span>
                    <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="789123456:AAEx…:987654321" className="font-mono text-xs" autoFocus />
                  </div>
                </>
              )}
              {type === 'discord' && (
                <>
                  <div className="rounded-xl bg-indigo-500/[0.06] p-4 ring-1 ring-inset ring-indigo-500/20">
                    <p className="mb-2 text-sm font-medium text-indigo-200">Create a Discord Webhook</p>
                    <p className="text-xs text-slate-400">In your Discord server:</p>
                    <ol className="mt-1.5 list-inside list-decimal space-y-0.5 text-xs text-slate-400">
                      <li>Channel settings → <strong className="text-slate-300">Integrations</strong></li>
                      <li>Click <strong className="text-slate-300">Create Webhook</strong></li>
                      <li>Copy the <strong className="text-slate-300">webhook URL</strong></li>
                    </ol>
                  </div>
                  <div>
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">Discord Webhook URL</span>
                    <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://discord.com/api/webhooks/…" className="font-mono text-xs" autoFocus />
                  </div>
                </>
              )}
              {type === 'webhook' && (
                <>
                  <div className="rounded-xl bg-amber-500/[0.06] p-4 ring-1 ring-inset ring-amber-500/20">
                    <p className="mb-2 text-sm font-medium text-amber-200">Generic Webhook</p>
                    <p className="text-xs text-slate-400">NineDeploy will POST JSON to your URL for every matching event:</p>
                    <pre className="mt-2 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px] text-amber-200/80">{`{
  "event": "deploy.trigger",
  "entity": "my-api",
  "message": "🚀 deploy trigger: my-api",
  "ts": "2026-01-01T12:00:00Z"
}`}</pre>
                  </div>
                  <div>
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">Webhook URL</span>
                    <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://your-app.com/webhook" className="font-mono text-xs" autoFocus />
                  </div>
                </>
              )}
              <div>
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">Name (optional)</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${selectedType!.label} alerts`} />
              </div>
            </div>
          )}

          {/* Step 3: Event selection — visual toggle cards */}
          {step === 2 && (
            <div>
              <p className="mb-4 text-sm text-slate-400">Which events should trigger a notification?</p>
              <div className="grid grid-cols-2 gap-2.5">
                {EVENT_GROUPS.map((g) => {
                  const active = selectedEvents.has(g.id);
                  return (
                    <button key={g.id} type="button" onClick={() => toggleEvent(g.id)}
                      className={cn('flex flex-col gap-1 rounded-xl border p-3 text-left transition', active ? 'border-indigo-500/60 bg-indigo-500/[0.06]' : 'border-white/10 hover:border-white/20')}>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{g.emoji}</span>
                        <span className={cn('text-sm font-medium', active ? 'text-slate-100' : 'text-slate-400')}>{g.label}</span>
                        {active && <Check size={14} className="ml-auto text-indigo-400" />}
                      </div>
                      <span className="text-[10px] text-slate-500">{g.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 4: Test */}
          {step === 3 && (
            <div className="flex flex-col items-center py-6 text-center">
              <div className={cn('grid h-16 w-16 place-items-center rounded-2xl transition', tested === 'ok' ? 'bg-emerald-500/15 text-emerald-300' : tested === 'fail' ? 'bg-rose-500/15 text-rose-300' : 'bg-indigo-500/15 text-indigo-300')}>
                {tested === 'ok' ? <Check size={28} /> : tested === 'fail' ? <X size={28} /> : <Zap size={28} />}
              </div>
              <p className="mt-4 text-sm font-medium text-slate-200">
                {tested === 'ok' ? 'Test message sent!' : tested === 'fail' ? 'Test failed — check your settings' : 'Ready to test?'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {tested === 'ok' ? 'Check your ' + (type === 'telegram' ? 'Telegram' : type === 'discord' ? 'Discord' : 'webhook') + ' for a test message.' : 'We\'ll send a test notification to verify your setup.'}
              </p>

              {/* Summary */}
              <div className="mt-5 w-full space-y-1.5 rounded-xl bg-white/[0.02] p-3 text-left">
                <SummaryRow label="Channel" value={selectedType!.label} />
                <SummaryRow label="Events" value={selectedEvents.size > 0 ? Array.from(selectedEvents).join(', ') : 'all'} />
                <SummaryRow label="Target" value={target.slice(0, 40) + (target.length > 40 ? '…' : '')} />
              </div>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/5 p-4">
          <Button type="button" variant="ghost" size="sm" onClick={back} className={cn(step === 0 && 'invisible')}>
            <ArrowLeft size={14} /> Back
          </Button>
          <Button type="submit" onClick={onSubmit} disabled={!canNext || testing || create.isPending}>
            {step === 3 ? (
              tested === 'ok' ? (
                create.isPending ? 'Creating…' : <><Check size={15} /> Create channel</>
              ) : testing ? (
                'Testing…'
              ) : (
                <><Send size={15} /> Send test</>
              )
            ) : (
              <>Continue <ArrowRight size={14} /></>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-[65%] truncate font-mono text-slate-300">{value}</span>
    </div>
  );
}
