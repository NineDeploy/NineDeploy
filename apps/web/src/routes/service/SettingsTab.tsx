import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Service } from '@ninedeploy/sdk';
import { api } from '../../lib/api.js';
import { toInt } from '../../lib/format.js';
import { useToast } from '../../components/Toast.js';
import { Button, Card, CardBody, Field, Input, Select, Skeleton } from '../../components/ui.js';

/** Service fields, build configuration and resource limits. */
export function SettingsTab({ serviceId, svc }: { serviceId: number; svc: Service }) {
  return (
    <div className="mt-5 space-y-5">
      <SettingsCard serviceId={serviceId} />
      <LimitsCard svc={svc} />
    </div>
  );
}

// ── Settings (service fields + build config) ───────────────────────────────
function SettingsCard({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const service = useQuery({ queryKey: ['service', serviceId], queryFn: () => api.services.get(serviceId) });
  const svc = service.data;

  const [form, setForm] = useState<{
    name: string; branch: string; repoUrl: string; image: string; port: string;
    healthPath: string; volumeMount: string;
    buildPack: string; baseDir: string; installCmd: string; buildCmd: string; startCmd: string; dockerfilePath: string;
    restartPolicy: string; stopGraceSeconds: string;
  } | null>(null);
  useEffect(() => {
    if (!svc || form) return;
    setForm({
      name: svc.name,
      branch: svc.branch,
      repoUrl: svc.repoUrl ?? '',
      image: svc.image ?? '',
      port: svc.port ? String(svc.port) : '',
      healthPath: svc.healthPath ?? '',
      volumeMount: svc.volumeMount ?? '',
      buildPack: svc.build?.buildPack ?? 'auto',
      baseDir: svc.build?.baseDir ?? '/',
      installCmd: svc.build?.installCmd ?? '',
      buildCmd: svc.build?.buildCmd ?? '',
      startCmd: svc.build?.startCmd ?? '',
      dockerfilePath: svc.build?.dockerfilePath ?? '',
      restartPolicy: svc.build?.restartPolicy ?? 'unless-stopped',
      stopGraceSeconds: String(svc.build?.stopGraceSeconds ?? 5),
    });
  }, [svc, form]);

  const save = useMutation({
    mutationFn: () => {
      const f = form!;
      // Omit empty optional fields so a PATCH never clears values the form left blank.
      const orUndef = <T,>(v: T) => (v === '' ? undefined : v);
      return api.services.update(serviceId, {
        name: f.name,
        branch: f.branch,
        repoUrl: orUndef(f.repoUrl),
        image: orUndef(f.image),
        port: orUndef(f.port) ? toInt(f.port) : undefined,
        healthPath: orUndef(f.healthPath),
        volumeMount: orUndef(f.volumeMount),
        build: {
          buildPack: f.buildPack as 'auto' | 'nixpacks' | 'dockerfile',
          baseDir: f.baseDir,
          installCmd: orUndef(f.installCmd),
          buildCmd: orUndef(f.buildCmd),
          startCmd: orUndef(f.startCmd),
          dockerfilePath: orUndef(f.dockerfilePath),
          restartPolicy: f.restartPolicy,
          stopGraceSeconds: toInt(f.stopGraceSeconds, 5)!,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', serviceId] });
      qc.invalidateQueries({ queryKey: ['services'] });
      toast('Settings saved — redeploy to apply', 'success');
    },
    onError: () => toast('Could not save settings', 'error'),
  });

  if (!svc || !form) return <Card><CardBody><Skeleton className="h-40 w-full" /></CardBody></Card>;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-300">
          <Settings size={15} className="text-slate-500" /> Service settings
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          <Field label="Name"><Input value={form.name} onChange={set('name')} className="h-9" /></Field>
          <Field label="Branch"><Input value={form.branch} onChange={set('branch')} className="h-9" /></Field>
          <Field label="Repo URL"><Input value={form.repoUrl} onChange={set('repoUrl')} placeholder="https://github.com/…" className="h-9 font-mono text-xs" /></Field>
          <Field label="Image (image deploys)"><Input value={form.image} onChange={set('image')} placeholder="nginx:latest" className="h-9 font-mono text-xs" /></Field>
          <Field label="Port"><Input value={form.port} onChange={set('port')} inputMode="numeric" placeholder="3000" className="h-9 font-mono text-xs" /></Field>
          <Field label="Health path"><Input value={form.healthPath} onChange={set('healthPath')} placeholder="/" className="h-9 font-mono text-xs" /></Field>
          <Field label="Volume mount"><Input value={form.volumeMount} onChange={set('volumeMount')} placeholder="/app/data" className="h-9 font-mono text-xs" /></Field>

          <div className="col-span-full mt-2 border-t border-white/5 pt-4 text-xs font-medium uppercase tracking-wide text-slate-500">
            Build configuration
          </div>
          <Field label="Build pack">
            <Select value={form.buildPack} onChange={set('buildPack')} className="h-9">
              <option value="auto">auto</option>
              <option value="nixpacks">nixpacks</option>
              <option value="dockerfile">dockerfile</option>
            </Select>
          </Field>
          <Field label="Base directory"><Input value={form.baseDir} onChange={set('baseDir')} className="h-9 font-mono text-xs" /></Field>
          <Field label="Install command"><Input value={form.installCmd} onChange={set('installCmd')} placeholder="npm ci" className="h-9 font-mono text-xs" /></Field>
          <Field label="Build command"><Input value={form.buildCmd} onChange={set('buildCmd')} placeholder="npm run build" className="h-9 font-mono text-xs" /></Field>
          <Field label="Start command"><Input value={form.startCmd} onChange={set('startCmd')} placeholder="npm start" className="h-9 font-mono text-xs" /></Field>
          <Field label="Dockerfile path"><Input value={form.dockerfilePath} onChange={set('dockerfilePath')} placeholder="./Dockerfile" className="h-9 font-mono text-xs" /></Field>
          <Field label="Restart policy">
            <Select value={form.restartPolicy} onChange={set('restartPolicy')} className="h-9">
              <option value="unless-stopped">unless-stopped</option>
              <option value="always">always</option>
              <option value="on-failure">on-failure</option>
              <option value="on-failure:5">on-failure:5 (loop cap)</option>
              <option value="no">no</option>
            </Select>
          </Field>
          <Field label="Stop grace (seconds)">
            <Input value={form.stopGraceSeconds} onChange={set('stopGraceSeconds')} inputMode="numeric" placeholder="5" className="h-9 font-mono text-xs" />
          </Field>

          <div className="col-span-full">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save settings'}
            </Button>
            <span className="ml-3 text-xs text-slate-500">Build + runtime changes apply on the next deploy.</span>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

// ── Resource limits ────────────────────────────────────────────────────────
function LimitsCard({ svc }: { svc: Service }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  // Initialized once from the service row — later refetches never fight user edits.
  const [cpu, setCpu] = useState(String(svc.cpuShares || ''));
  const [mem, setMem] = useState(String(svc.memLimitMb || ''));

  const save = useMutation({
    mutationFn: () =>
      api.limits.setService(svc.id, {
        cpuShares: toInt(cpu, 0)!,
        memLimitMb: toInt(mem, 0)!,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', svc.id] });
      toast('Limits saved — applied on next deploy', 'success');
    },
    onError: () => toast('Could not save limits', 'error'),
  });

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-300">
          <Cpu size={15} className="text-slate-500" /> Resource limits
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="flex flex-wrap items-end gap-4"
        >
          <Field label="CPU shares (0 = unlimited)">
            <Input value={cpu} onChange={(e) => setCpu(e.target.value)} inputMode="numeric" className="h-9 w-44 font-mono text-xs" />
          </Field>
          <Field label="Memory limit MiB (0 = unlimited)">
            <Input value={mem} onChange={(e) => setMem(e.target.value)} inputMode="numeric" className="h-9 w-44 font-mono text-xs" />
          </Field>
          <Button type="submit" size="sm" variant="secondary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save limits'}
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          CPU shares map to Docker's <code className="font-mono">--cpu-shares</code> (max 262144); memory to <code className="font-mono">--memory</code>. Applied on the next deploy.
        </p>
      </CardBody>
    </Card>
  );
}
