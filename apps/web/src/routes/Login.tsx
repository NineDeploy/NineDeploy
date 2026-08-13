import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { BrandMark, Button, Card, Field, Input } from '../components/ui.js';

export function Login() {
  const { user, login, setup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const status = useQuery({ queryKey: ['auth-status'], queryFn: () => api.auth.status() });
  const initialized = status.data?.initialized ?? false;

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (initialized) await login(email, password);
      else await setup(email, password, name || undefined);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm nd-fade">
        <div className="mb-7 flex flex-col items-center text-center">
          <BrandMark size={44} />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">NineDeploy</h1>
          <p className="text-sm text-slate-500">Self-hosted deploys, in one click.</p>
        </div>

        <Card className="p-6">
          <h2 className="text-base font-semibold">{initialized ? 'Welcome back' : 'Create admin account'}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {initialized ? 'Sign in to manage your services.' : 'First run — set up the administrator account.'}
          </p>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            {!initialized && (
              <Field label="Display name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Admin" />
              </Field>
            )}
            <Field label="Email">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={initialized ? 'current-password' : 'new-password'}
              />
            </Field>

            {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

            <Button type="submit" className="w-full" disabled={busy || status.isLoading}>
              {busy ? 'Please wait…' : initialized ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
