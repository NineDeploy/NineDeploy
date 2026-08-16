import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Cloud, KeyRound } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../components/Toast.js';
import { Button, Card, CardBody } from '../../components/ui.js';

// Vault reference examples (escaped so linters don't read them as template placeholders).
const REF_INFISICAL = '\u0024\u007B\u007Binfisical:KEY\u007D\u007D';
const REF_DOPPLER = '\u0024\u007B\u007Bdoppler:KEY\u007D\u007D';

/** Integrations: vault providers (deploy-time secrets) + Cloudflare DNS records. */
export function IntegrationsSection() {
  return (
    <>
      <VaultCard />
      <CloudflareCard />
    </>
  );
}

// ── Vault provider ─────────────────────────────────────────────────────────
function VaultCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const vault = useQuery({ queryKey: ['settings-vault'], queryFn: () => api.settings.vault.get() });
  const [provider, setProvider] = useState<'' | 'infisical' | 'doppler'>('infisical');
  const [token, setToken] = useState('');
  const [projectId, setProjectId] = useState('');
  const [environment, setEnvironment] = useState('');
  const initialized =
    provider === (vault.data?.provider ?? '') && (vault.data?.hasToken || token.length > 0);

  const save = useMutation({
    mutationFn: () =>
      api.settings.vault.set({
        provider,
        ...(token ? { token } : {}),
        ...(provider === 'infisical' ? { projectId, environment: environment || 'default' } : { environment: environment || 'dev' }),
      }),
    onSuccess: () => {
      setToken('');
      qc.invalidateQueries({ queryKey: ['settings-vault'] });
      toast('Vault settings saved', 'success');
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Save failed', 'error'),
  });

  const test = useMutation({
    mutationFn: () => api.settings.vault.test(),
    onSuccess: (res) => toast(`Connected — ${res.secrets} secrets reachable`, 'success'),
    onError: (err) => toast(err instanceof Error ? err.message : 'Connection failed', 'error'),
  });

  return (
    <Card className="mb-5">
      <CardBody>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <KeyRound size={14} /> Vault provider
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          Resolve env values from an external secret store at deploy time with{' '}
          <code className="rounded bg-white/5 px-1 font-mono text-[10px]">{REF_INFISICAL}</code> /
          <code className="ml-1 rounded bg-white/5 px-1 font-mono text-[10px]">{REF_DOPPLER}</code> references.
          Resolved values are never stored.
        </p>
        <div className="grid max-w-md gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">Provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as '' | 'infisical' | 'doppler')}
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            >
              <option value="infisical">Infisical</option>
              <option value="doppler">Doppler</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">
              API token {vault.data?.hasToken ? '(stored — leave blank to keep)' : ''}
            </span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Universal Auth / service token"
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">
                {provider === 'infisical' ? 'Workspace ID' : 'Project'}
              </span>
              <input
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">
                {provider === 'infisical' ? 'Environment' : 'Config'}
              </span>
              <input
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                placeholder={provider === 'infisical' ? 'default' : 'dev'}
                className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || (!vault.data?.hasToken && !token)}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => test.mutate()} disabled={test.isPending || !initialized}>
              {test.isPending ? 'Testing…' : 'Test connection'}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ── Cloudflare DNS records ────────────────────────────────────────────────
function CloudflareCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const dns = useQuery({ queryKey: ['settings-dns-records'], queryFn: () => api.settings.dnsRecords.get() });
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [token, setToken] = useState('');
  const [content, setContent] = useState('');
  const isOn = enabled ?? dns.data?.enabled ?? false;

  const save = useMutation({
    mutationFn: () =>
      api.settings.dnsRecords.set({
        enabled: isOn,
        ...(token ? { token } : {}),
        ...(content ? { content } : {}),
      }),
    onSuccess: () => {
      setToken('');
      setContent('');
      qc.invalidateQueries({ queryKey: ['settings-dns-records'] });
      toast('DNS records settings saved', 'success');
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Save failed', 'error'),
  });

  const test = useMutation({
    mutationFn: () => api.settings.dnsRecords.test(),
    onSuccess: (res) => {
      if (res.ok) toast(`Token valid (${res.status ?? 'active'})`, 'success');
      else toast(res.error ?? 'Token invalid', 'error');
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Connection failed', 'error'),
  });

  return (
    <Card className="mb-5">
      <CardBody>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <Cloud size={14} /> Cloudflare DNS records
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          When enabled, adding a domain to a service automatically creates the matching Cloudflare record
          (A for an IP, CNAME for a hostname); deleting the domain removes it.
        </p>
        <div className="grid max-w-md gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={isOn}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-indigo-500"
            />
            Enable automatic record creation
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">
              API token {dns.data?.hasToken ? '(stored — leave blank to keep)' : ''}
            </span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Zone:DNS:Edit-capable token"
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">Record content (blank = auto-detect public IP)</span>
            <input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="203.0.113.10 or cname.example.com"
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
            />
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || (isOn && !dns.data?.hasToken && !token)}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => test.mutate()} disabled={test.isPending || !(dns.data?.hasToken || token)}>
              {test.isPending ? 'Testing…' : 'Test token'}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
