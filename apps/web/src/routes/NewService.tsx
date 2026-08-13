import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api.js';
import { Button, Card, CardBody, Field, Input, Select } from '../components/ui.js';

export function NewService() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<'docker' | 'pm2'>('docker');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [port, setPort] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [volumeMount, setVolumeMount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api.sources.list() });

  const create = useMutation({
    mutationFn: () =>
      api.services.create({
        name,
        type,
        repoUrl,
        branch,
        sourceId: sourceId ? Number(sourceId) : undefined,
        port: port ? Number(port) : undefined,
        volumeMount: volumeMount || undefined,
      }),
    onSuccess: (svc) => {
      qc.invalidateQueries({ queryKey: ['services'] });
      navigate(`/services/${svc.id}`, { replace: true });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not create service'),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate();
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link to="/" className="text-sm text-slate-400 hover:text-slate-200">
          ← Back to services
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New service</h1>
      </div>

      <Card>
        <CardBody>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="my-api" />
              </Field>
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(e.target.value as 'docker' | 'pm2')}>
                  <option value="docker">Docker</option>
                  <option value="pm2">PM2</option>
                </Select>
              </Field>
            </div>

            <Field label="Repository URL">
              <Input
                required
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/you/repo"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Branch">
                <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
              </Field>
              <Field label="Source (for private repos)">
                <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                  <option value="">Public / none</option>
                  {sources.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.type})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Port (optional)">
              <Input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="3000"
              />
            </Field>

            <Field label="Persistent volume (container path, optional)">
              <Input
                value={volumeMount}
                onChange={(e) => setVolumeMount(e.target.value)}
                placeholder="/app/data"
                className="font-mono text-xs"
              />
            </Field>

            {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Link to="/">
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" disabled={create.isPending || !name || !repoUrl}>
                {create.isPending ? 'Creating…' : 'Create service'}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
