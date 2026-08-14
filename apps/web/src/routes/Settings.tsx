import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, Database, Download, HardDrive, Info, KeyRound, Network, Package, Send, Server, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, getToken, setSessionTokens } from '../lib/api.js';
import { useTheme, ACCENTS } from '../lib/theme.js';
import { useToast } from '../components/Toast.js';
import { Button, Card, CardBody, Skeleton, cn } from '../components/ui.js';
import { NotificationWizard } from '../components/NotificationWizard.js';

export function Settings() {
  const qc = useQueryClient();
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.stats.snapshot(), staleTime: 10000 });
  const resources = useQuery({ queryKey: ['docker-resources'], queryFn: () => api.system.resources(), staleTime: 10000 });
  const { theme, accent, setTheme, setAccent } = useTheme();
  const { toast } = useToast();
  const host = stats.data?.host;
  const s = resources.data;
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const channels = useQuery({ queryKey: ['notif-channels'], queryFn: () => api.notifications.listChannels() });
  const [showChannel, setShowChannel] = useState(false);
  const removeChannel = useMutation({ mutationFn: (id: number) => api.notifications.removeChannel(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['notif-channels'] }) });
  const testChannel = useMutation({ mutationFn: (id: number) => api.notifications.testChannel(id), onSuccess: () => toast('Test sent!', 'success'), onError: () => toast('Test failed', 'error') });

  // ── Account: self-service password change ───────────────────────────────
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNext, setPwNext] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const changePassword = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) => api.auth.changePassword(input),
    onSuccess: (session) => {
      // The endpoint revoked every other session and returned a fresh pair —
      // persist it so the caller stays logged in.
      setSessionTokens(session.tokens.accessToken, session.tokens.refreshToken);
      setPwCurrent('');
      setPwNext('');
      setPwConfirm('');
      toast('Password changed — other sessions signed out', 'success');
    },
    onError: () => toast('Password change failed', 'error'),
  });
  // ── Security: open-registration toggle ───────────────────────────────────
  const instanceSettings = useQuery({ queryKey: ['instance-settings'], queryFn: () => api.settings.get() });
  // Hoisted so the loading fallback is computed once.
  const allowRegistration = instanceSettings.data?.allowRegistration ?? true;
  const setAllowRegistration = useMutation({
    mutationFn: (enabled: boolean) => api.settings.setAllowRegistration(enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instance-settings'] }),
    onError: () => toast('Could not update the setting', 'error'),
  });
  // ── Security: ACME (Let's Encrypt) email ────────────────────────────────
  const acmeEmail = instanceSettings.data?.acmeEmail ?? null;
  const [acmeInput, setAcmeInput] = useState<string | null>(null);
  const setAcmeEmail = useMutation({
    mutationFn: (email: string) => api.settings.setAcmeEmail(email),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instance-settings'] });
      setAcmeInput(null);
      toast('ACME email saved — applies on next restart', 'success');
    },
    onError: () => toast('Could not save the ACME email', 'error'),
  });

  const submitPassword = () => {
    if (pwNext !== pwConfirm) {
      toast('New passwords do not match', 'error');
      return;
    }
    if (pwNext.length < 8) {
      toast('New password must be at least 8 characters', 'error');
      return;
    }
    changePassword.mutate({ currentPassword: pwCurrent, newPassword: pwNext });
  };

  const doExport = async () => {
    try {
      toast('Preparing export…', 'info');
      const res = await fetch('/v1/system/export', { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ninedeploy-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Export downloaded', 'success');
    } catch {
      toast('Export failed', 'error');
    }
  };

  const doImport = async (file: File) => {
    setImporting(true);
    try {
      toast('Importing… this may take a moment', 'info');
      const buf = await file.arrayBuffer();
      const res = await fetch('/v1/system/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${getToken() ?? ''}` },
        body: buf,
      });
      const json = await res.json();
      toast(json.message || 'Import complete — restart NineDeploy', 'success');
    } catch {
      toast('Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center gap-2">
        <Info size={20} className="text-indigo-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-slate-400">System information &amp; resource overview.</p>
        </div>
      </div>

      {/* Account */}
      <Card className="mb-5">
        <CardBody>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <KeyRound size={14} /> Account
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            Changing your password signs out every other session of this account.
          </p>
          <div className="grid max-w-md gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Current password</span>
              <input
                type="password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">New password</span>
              <input
                type="password"
                value={pwNext}
                onChange={(e) => setPwNext(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Confirm new password</span>
              <input
                type="password"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </label>
            <div>
              <Button onClick={submitPassword} disabled={changePassword.isPending || !pwCurrent || !pwNext}>
                {changePassword.isPending ? 'Changing…' : 'Change password'}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Security */}
      <Card className="mb-5">
        <CardBody>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            <ShieldCheck size={14} /> Security
          </h2>
          <p className="mb-4 text-xs text-slate-500">
            When disabled, only existing users can sign in — new accounts cannot self-register.
          </p>
          <label className="flex max-w-md items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
            <span className="text-sm text-slate-300">Allow open registration</span>
            <button
              role="switch"
              aria-checked={allowRegistration}
              disabled={instanceSettings.isLoading || setAllowRegistration.isPending}
              onClick={() => setAllowRegistration.mutate(!allowRegistration)}
              className={cn(
                'relative h-6 w-11 rounded-full transition',
                allowRegistration ? 'bg-emerald-500/80' : 'bg-slate-700',
              )}
              title="Toggle whether /v1/auth/register accepts new accounts"
            >
              <span
                className={cn(
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
                  allowRegistration ? 'left-[22px]' : 'left-0.5',
                )}
              />
            </button>
          </label>

          <p className="mb-2 mt-6 text-sm text-slate-300">
            Let's Encrypt (ACME) account email — used for certificate issuance and expiry notices.
            {acmeEmail ? ' Configured.' : ' Not configured — SSL domains use a self-signed fallback cert.'}
          </p>
          <div className="flex max-w-md items-center gap-2">
            <input
              type="email"
              value={acmeInput ?? acmeEmail ?? ''}
              onChange={(e) => setAcmeInput(e.target.value)}
              placeholder="admin@example.com"
              className="h-9 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 font-mono text-xs text-slate-200 outline-none focus:border-indigo-500/60"
              aria-label="ACME account email"
            />
            <Button
              size="sm"
              onClick={() => setAcmeEmail.mutate((acmeInput ?? acmeEmail ?? '').trim())}
              disabled={setAcmeEmail.isPending}
            >
              {setAcmeEmail.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">Applies when the server next restarts (Traefik is recreated then).</p>
        </CardBody>
      </Card>

      {/* Appearance */}
      <Card className="mb-5">
        <CardBody>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Appearance</h2>
          <div className="mb-4">
            <span className="mb-2 block text-xs text-slate-500">Theme</span>
            <div className="flex gap-2">
              {(['dark', 'light'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm capitalize transition',
                    theme === t
                      ? 'border-indigo-500/60 bg-indigo-500/10 text-slate-200'
                      : 'border-white/10 bg-white/[0.02] text-slate-500 hover:border-white/20',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-2 block text-xs text-slate-500">Accent color</span>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAccent(a.id)}
                  className={cn(
                    'group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition',
                    accent === a.id
                      ? 'border-white/20 bg-white/[0.06]'
                      : 'border-white/10 hover:border-white/20',
                  )}
                >
                  <span
                    className="h-4 w-4 rounded-full ring-2 ring-transparent transition group-hover:ring-white/20"
                    style={{ backgroundColor: a.color }}
                  />
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Wildcard Domain */}
      <Card className="mb-5">
        <CardBody>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Wildcard Domain</h2>
          <p className="mb-3 text-xs text-slate-500">
            Set a wildcard domain so every service automatically gets a URL like <code className="text-emerald-300">my-app.yourdomain.com</code>.
            Configure a wildcard DNS <code className="text-slate-400">*.yourdomain.com</code> → server IP, then set it here.
          </p>
          <div className="rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-inset ring-white/5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Current</span>
              <span className="font-mono text-sm text-emerald-300">
                {stats.data?.host ? '*.nd.local' : 'not configured'}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-600">
              Set via <code className="text-slate-500">NINEDEPLOY_WILDCARD_DOMAIN</code> env var and restart.
              Example: <code className="text-slate-500">NINEDEPLOY_WILDCARD_DOMAIN=ninedeploy.dev</code>
            </p>
          </div>
        </CardBody>
      </Card>

      {/* System info */}
      <Card className="mb-5">
        <CardBody>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">System</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InfoRow icon={<Server size={14} />} label="NineDeploy" value="v0.0.0 · MIT" />
            <InfoRow icon={<Network size={14} />} label="Docker network" value={s?.network ?? 'ninedeploy'} />
            <InfoRow icon={<Cpu size={14} />} label="CPU cores" value={host ? String(host.cpuCores) : '—'} />
            <InfoRow icon={<HardDrive size={14} />} label="Containers" value={s ? String(s.containers) : '—'} />
            <InfoRow icon={<Package size={14} />} label="Volumes" value={s ? String(s.volumes) : '—'} />
            <InfoRow icon={<Database size={14} />} label="Images" value={s?.imagesSummary ? `${s.imagesSummary.active}/${s.imagesSummary.total} active` : '—'} />
          </div>
        </CardBody>
      </Card>

      {/* Host resources */}
      <Card className="mb-5">
        <CardBody>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Host Resources</h2>
          {stats.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : host ? (
            <div className="space-y-3">
              <Bar label="Memory" pct={Math.round((host.memUsedBytes / host.memTotalBytes) * 100)} text={`${fmtB(host.memUsedBytes)} / ${fmtB(host.memTotalBytes)}`} />
              <Bar label="Disk" pct={Math.round((host.diskUsedBytes / host.diskTotalBytes) * 100)} text={`${fmtB(host.diskUsedBytes)} / ${fmtB(host.diskTotalBytes)}`} />
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Load average (1m)</span>
                <span className="font-mono text-slate-300">{host.load1.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600">Docker daemon not reachable.</p>
          )}
        </CardBody>
      </Card>

      {/* Image storage */}
      {s?.imagesSummary && (
        <Card className="mb-5">
          <CardBody>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Image Storage</h2>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Images use <span className="font-medium text-slate-200">{s.imagesSummary.size}</span></span>
              {s.imagesSummary.reclaimable !== '0B' && (
                <span className="text-xs text-amber-400">{s.imagesSummary.reclaimable} reclaimable</span>
              )}
            </div>
            <button
              onClick={() => resources.refetch()}
              className="mt-3 text-xs text-indigo-400 hover:underline"
            >
              Refresh
            </button>
          </CardBody>
        </Card>
      )}

      {/* Notifications */}
      <Card className="mb-5">
        <CardBody>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Notifications</h2>
            <Button size="sm" variant="secondary" onClick={() => setShowChannel(true)}>+ Add channel</Button>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Get notified on deploy, database, domain, backup events via Telegram, Discord, or any webhook.
          </p>
          {showChannel && <NotificationWizard onClose={() => setShowChannel(false)} />}
          <div className="space-y-1.5">
            {channels.data?.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-inset ring-white/5">
                <div className="flex items-center gap-2">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium uppercase', ch.type === 'telegram' ? 'bg-sky-500/15 text-sky-300' : ch.type === 'discord' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-amber-500/15 text-amber-300')}>{ch.type}</span>
                  <span className="text-sm text-slate-200">{ch.name}</span>
                  {ch.eventFilter && <span className="font-mono text-[10px] text-slate-500">{ch.eventFilter}</span>}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => testChannel.mutate(ch.id)} className="rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-emerald-300" title="Send test"><Send size={13} /></button>
                  <button onClick={() => removeChannel.mutate(ch.id)} className="rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-rose-400" title="Remove"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
            {(!channels.data || channels.data.length === 0) && !showChannel && <p className="py-2 text-xs text-slate-600">No notification channels configured.</p>}
          </div>
        </CardBody>
      </Card>

      {/* Migration */}
      <Card className="mb-5">
        <CardBody>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Migration</h2>
          <p className="mb-3 text-xs text-slate-500">
            Export the full system state (database, encryption key, Traefik config, .env) to migrate to another server.
            Import on the new server, then restart.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={doExport}
              className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.08]"
            >
              <Download size={15} /> Export backup
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.08] disabled:opacity-50"
            >
              <Upload size={15} /> {importing ? 'Importing…' : 'Import backup'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".gz,.tar.gz,application/gzip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) doImport(f);
                e.target.value = '';
              }}
            />
          </div>
        </CardBody>
      </Card>

      {/* Quick links */}
      <Card>
        <CardBody>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Quick Links</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <a href="/v1/activity" className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-200">Activity log</a>
            <a href="/health" className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-200">Health check</a>
            <a href="https://github.com/ninedeploy/ninedeploy" target="_blank" rel="noreferrer" className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-200">GitHub ↗</a>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2">
      <span className="flex items-center gap-2 text-xs text-slate-500">
        <span className="text-slate-400">{icon}</span> {label}
      </span>
      <span className="font-mono text-xs text-slate-200">{value}</span>
    </div>
  );
}

function Bar({ label, pct, text }: { label: string; pct: number; text: string }) {
  const tone = pct > 85 ? 'bg-rose-500' : pct > 65 ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-400">{pct}% · {text}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function fmtB(b: number): string {
  const gb = b / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(b / 1024 ** 2).toFixed(0)} MB`;
}
