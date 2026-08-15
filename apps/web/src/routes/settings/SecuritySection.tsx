import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../components/Toast.js';
import { Button, Card, CardBody, cn } from '../../components/ui.js';

/** Security: open registration, ACME, template source, DNS-01 and wildcard domain. */
export function SecuritySection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const instanceSettings = useQuery({ queryKey: ['instance-settings'], queryFn: () => api.settings.get() });
  // Hoisted so the loading fallback is computed once.
  const allowRegistration = instanceSettings.data?.allowRegistration ?? true;
  const setAllowRegistration = useMutation({
    mutationFn: (enabled: boolean) => api.settings.setAllowRegistration(enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instance-settings'] }),
    onError: () => toast('Could not update the setting', 'error'),
  });
  // ── ACME (Let's Encrypt) email ───────────────────────────────────────────
  const acmeEmail = instanceSettings.data?.acmeEmail ?? null;
  const [acmeInput, setAcmeInput] = useState<string | null>(null);
  // ── Template hub registry source ────────────────────────────────────────
  const templatesSource = instanceSettings.data?.templatesSource ?? null;
  const [tplInput, setTplInput] = useState<string | null>(null);
  // ── DNS-01 challenge (wildcard SSL) ─────────────────────────────────────
  const dnsProvider = instanceSettings.data?.dnsProvider ?? '';
  const hasDnsToken = instanceSettings.data?.hasDnsToken ?? false;
  const wildcardApex = instanceSettings.data?.wildcardApex ?? '';
  const [dnsProviderInput, setDnsProviderInput] = useState<string | null>(null);
  const [dnsTokenInput, setDnsTokenInput] = useState('');
  const [dnsApexInput, setDnsApexInput] = useState<string | null>(null);
  const setAcmeEmail = useMutation({
    mutationFn: (email: string) => api.settings.setAcmeEmail(email),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instance-settings'] });
      setAcmeInput(null);
      toast('ACME email saved — applies on next restart', 'success');
    },
    onError: () => toast('Could not save the ACME email', 'error'),
  });
  const setTemplatesSource = useMutation({
    mutationFn: (source: string) => api.settings.setTemplatesSource(source),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instance-settings'] });
      setTplInput(null);
      toast('Template registry source saved', 'success');
    },
    onError: () => toast('Could not save the template source', 'error'),
  });
  const setDns = useMutation({
    mutationFn: (input: { provider: string; token?: string; wildcardApex: string }) => api.settings.setDns(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instance-settings'] });
      setDnsProviderInput(null);
      setDnsApexInput(null);
      setDnsTokenInput('');
      toast('DNS challenge saved — applies on next restart', 'success');
    },
    onError: () => toast('Could not save the DNS challenge settings', 'error'),
  });

  return (
    <>
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

          <p className="mb-2 mt-6 text-sm text-slate-300">
            Template hub registry source
            {templatesSource ? ` — custom (${templatesSource}).` : ' — bundled registry from this repo.'}
          </p>
          <div className="flex max-w-md items-center gap-2">
            <input
              type="text"
              value={tplInput ?? templatesSource ?? ''}
              onChange={(e) => setTplInput(e.target.value)}
              placeholder="https://example.com/registry.json or /path/to/registry.json"
              className="h-9 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 font-mono text-xs text-slate-200 outline-none focus:border-indigo-500/60"
              aria-label="Template registry source"
            />
            <Button
              size="sm"
              onClick={() => setTemplatesSource.mutate((tplInput ?? templatesSource ?? '').trim())}
              disabled={setTemplatesSource.isPending}
            >
              {setTemplatesSource.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">JSON format: {'{ version, templates: [{ id, name, tagline, description, category, emoji, image, port, … }] }'} — remote sources refresh every 6 hours; on failure the cache/built-in registry takes over.</p>

          <p className="mb-2 mt-6 text-sm text-slate-300">
            DNS challenge (wildcard SSL){hasDnsToken ? ' — API token configured.' : ' — no API token yet.'}
          </p>
          <div className="max-w-md space-y-2">
            <select
              value={dnsProviderInput ?? dnsProvider}
              onChange={(e) => setDnsProviderInput(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 text-xs text-slate-200 outline-none focus:border-indigo-500/60"
              aria-label="DNS provider"
            >
              <option value="">None (HTTP-01 only)</option>
              <option value="cloudflare">Cloudflare</option>
              <option value="digitalocean">DigitalOcean</option>
              <option value="hetzner">Hetzner</option>
              <option value="linode">Linode</option>
              <option value="gandi">Gandi</option>
              <option value="duckdns">DuckDNS</option>
            </select>
            <input
              type="password"
              value={dnsTokenInput}
              onChange={(e) => setDnsTokenInput(e.target.value)}
              placeholder={hasDnsToken ? 'API token (stored — leave empty to keep)' : 'API token'}
              className="h-9 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 font-mono text-xs text-slate-200 outline-none focus:border-indigo-500/60"
              aria-label="DNS API token"
            />
            <input
              type="text"
              value={dnsApexInput ?? wildcardApex}
              onChange={(e) => setDnsApexInput(e.target.value)}
              placeholder="example.com → *.example.com wildcard certificate"
              className="h-9 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 font-mono text-xs text-slate-200 outline-none focus:border-indigo-500/60"
              aria-label="Wildcard domain apex"
            />
            <div>
              <Button
                size="sm"
                onClick={() =>
                  setDns.mutate({
                    provider: (dnsProviderInput ?? dnsProvider).trim(),
                    token: dnsTokenInput.trim() || undefined,
                    wildcardApex: (dnsApexInput ?? wildcardApex).trim(),
                  })
                }
                disabled={setDns.isPending}
              >
                {setDns.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            DNS-01 enables wildcard certificates (<code>*.example.com</code>) via your DNS provider; the token is stored
            encrypted and reaches Traefik through a docker --env-file. Applies on next restart.
          </p>
        </CardBody>
      </Card>

      {/* Wildcard Domain — reads the configured apex from the settings API */}
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
                {wildcardApex ? `*.${wildcardApex}` : 'not configured'}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-600">
              Set via <code className="text-slate-500">NINEDEPLOY_WILDCARD_DOMAIN</code> env var and restart.
              Example: <code className="text-slate-500">NINEDEPLOY_WILDCARD_DOMAIN=ninedeploy.dev</code>
            </p>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
