import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { KeyRound, Smartphone } from 'lucide-react';
import { api, setSessionTokens } from '../../lib/api.js';
import { useToast } from '../../components/Toast.js';
import { Button, Card, CardBody } from '../../components/ui.js';
import { useCopy } from '../../lib/format.js';

/** Account: self-service password change + two-factor authentication. */
export function AccountSection() {
  const { toast } = useToast();
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

  return (
    <>
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

      <TwoFactorCard />
    </>
  );
}

// ── Two-factor (TOTP) ─────────────────────────────────────────────────────
function TwoFactorCard() {
  const { toast } = useToast();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showDisable, setShowDisable] = useState(false);

  const doSetup = useMutation({
    mutationFn: () => api.auth.twoFactor.setup(),
    onSuccess: (res) => {
      setSetup(res);
      setCode('');
    },
    onError: () => toast('Could not start 2FA setup', 'error'),
  });
  const enable = useMutation({
    mutationFn: () => api.auth.twoFactor.enable(code),
    onSuccess: () => {
      setSetup(null);
      setCode('');
      toast('Two-factor authentication enabled', 'success');
    },
    onError: () => toast('Invalid or expired code', 'error'),
  });
  const disable = useMutation({
    mutationFn: () => api.auth.twoFactor.disable({ password: disablePassword, code: disableCode }),
    onSuccess: () => {
      setShowDisable(false);
      setDisablePassword('');
      setDisableCode('');
      setSetup(null);
      toast('Two-factor authentication disabled — you were signed out everywhere', 'info');
      setTimeout(() => window.location.assign('/login'), 1500);
    },
    onError: () => toast('Could not disable 2FA — check your password and code', 'error'),
  });

  const { copy: copyText } = useCopy();
  const copy = async (value: string) => {
    const ok = await copyText(value);
    if (ok) toast('Copied', 'success');
    else toast('Copy failed', 'error');
  };

  return (
    <Card className="mb-5">
      <CardBody>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <Smartphone size={14} /> Two-factor authentication
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          Require a time-based one-time code (TOTP) from an authenticator app in addition to your password.
        </p>

        {!setup && !showDisable && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => doSetup.mutate()} disabled={doSetup.isPending}>
              {doSetup.isPending ? 'Generating…' : 'Set up 2FA'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowDisable(true)}>
              Disable 2FA
            </Button>
          </div>
        )}

        {setup && (
          <div className="max-w-md space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-4">
            <p className="text-xs font-medium text-amber-200">
              Add this secret to your authenticator app (Google Authenticator, 1Password, Aegis…), then confirm with a code.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] text-amber-100">
                {setup.secret}
              </code>
              <button onClick={() => copy(setup.secret)} className="shrink-0 text-xs font-medium text-amber-200 hover:text-amber-100">
                Copy
              </button>
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-black/40 px-2 py-1.5 font-mono text-[10px] text-amber-100/80" title={setup.otpauthUri}>
                {setup.otpauthUri}
              </code>
              <button onClick={() => copy(setup.otpauthUri)} className="shrink-0 text-xs font-medium text-amber-200 hover:text-amber-100">
                Copy URI
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 6) enable.mutate();
              }}
              className="flex items-end gap-2"
            >
              <label className="flex-1">
                <span className="mb-1 block text-xs text-amber-200/70">Confirm with a 6-digit code</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  placeholder="123456"
                  className="w-36 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
                />
              </label>
              <Button type="submit" size="sm" disabled={code.length !== 6 || enable.isPending}>
                {enable.isPending ? 'Verifying…' : 'Enable'}
              </Button>
              <button type="button" onClick={() => setSetup(null)} className="text-xs text-amber-200/70 hover:underline">
                Cancel
              </button>
            </form>
          </div>
        )}

        {showDisable && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (disablePassword && disableCode.length === 6) disable.mutate();
            }}
            className="grid max-w-md gap-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.05] p-4"
          >
            <p className="text-xs text-rose-200">Confirm with your password and a current 2FA code.</p>
            <input
              type="password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <input
              type="text"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              inputMode="numeric"
              className="w-36 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="danger" disabled={!disablePassword || disableCode.length !== 6 || disable.isPending}>
                {disable.isPending ? 'Disabling…' : 'Disable 2FA'}
              </Button>
              <button type="button" onClick={() => setShowDisable(false)} className="text-xs text-slate-400 hover:underline">
                Cancel
              </button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
