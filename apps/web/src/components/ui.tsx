import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
  useEffect,
  useRef,
  useState,
} from 'react';

export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// ── Brand ─────────────────────────────────────────────────────────────────
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-xl font-bold text-white shadow-lg shadow-indigo-500/30"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        background: 'linear-gradient(135deg, var(--nd-accent) 0%, var(--nd-accent-strong) 100%)',
      }}
    >
      9
    </span>
  );
}

// ── Button ────────────────────────────────────────────────────────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:brightness-110 [background-image:linear-gradient(135deg,var(--nd-accent),var(--nd-accent-strong))]',
  secondary: 'bg-white/[0.06] hover:bg-white/[0.1] text-slate-100 ring-1 ring-inset ring-white/10',
  ghost: 'hover:bg-white/[0.08] text-slate-300',
  danger: 'bg-rose-500/90 hover:bg-rose-500 text-white',
};
const SIZES: Record<Size, string> = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-11 px-5 text-sm' };

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Button({ variant = 'primary', size = 'md', className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-950',
        'disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
});

// ── Card ──────────────────────────────────────────────────────────────────
export function Card({
  className,
  children,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-white/[0.08] bg-white/[0.025] backdrop-blur-sm',
        interactive &&
          'cursor-pointer transition-all duration-200 hover:border-white/15 hover:bg-white/[0.04] hover:shadow-xl hover:shadow-black/40',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

// ── Inputs ────────────────────────────────────────────────────────────────
const fieldBase =
  'w-full rounded-lg bg-black/30 px-3 text-sm text-slate-100 ring-1 ring-inset ring-white/10 placeholder:text-slate-500 transition focus:outline-none focus:ring-2 focus:ring-indigo-400/60 focus:bg-black/40';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(fieldBase, 'h-10', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, 'py-2', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(fieldBase, 'h-10 appearance-none pr-8', className)} {...props} />
  );
});

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────────────
export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1 rounded-xl bg-white/[0.03] p-1 ring-1 ring-inset ring-white/[0.06]', className)}>
      {tabs.map((t) => (
        <button
          type="button"
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition',
            t.id === active ? 'bg-white/[0.1] text-slate-100 shadow-sm' : 'text-slate-400 hover:text-slate-200',
          )}
          role="tab"
          aria-selected={t.id === active}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 text-[10px] text-slate-500">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────
const STATUS_TONES: Record<string, string> = {
  running: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/20',
  idle: 'bg-slate-500/15 text-slate-300 ring-slate-500/20',
  deploying: 'bg-amber-500/15 text-amber-300 ring-amber-500/20',
  error: 'bg-rose-500/15 text-rose-300 ring-rose-500/20',
  stopped: 'bg-slate-500/15 text-slate-400 ring-slate-500/20',
  deleting: 'bg-amber-500/15 text-amber-300 ring-amber-500/20',
  queued: 'bg-sky-500/15 text-sky-300 ring-sky-500/20',
  building: 'bg-amber-500/15 text-amber-300 ring-amber-500/20',
  failed: 'bg-rose-500/15 text-rose-300 ring-rose-500/20',
  active: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/20',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        STATUS_TONES[status] ?? 'bg-slate-500/15 text-slate-300 ring-slate-500/20',
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" width="1em" height="1em" role="status">
      <title>Loading</title>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function FullScreenSpinner() {
  return (
    <div className="grid h-screen place-items-center text-slate-400">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-white/[0.06]', className)} />;
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && (
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.04] text-slate-500 ring-1 ring-inset ring-white/10">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Error state ───────────────────────────────────────────────────────────
export function ErrorCard({ title = 'Something went wrong', error, onRetry }: { title?: string; error?: unknown; onRetry?: () => void }) {
  return (
    <Card className="border-rose-500/20 bg-rose-500/[0.04]">
      <CardBody className="flex flex-col items-start gap-3">
        <div>
          <p className="text-sm font-medium text-rose-200">{title}</p>
          <p className="mt-1 text-xs text-rose-300/70">{error instanceof Error ? error.message : 'Unexpected error'}</p>
        </div>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────
/**
 * Shared modal chrome: backdrop click + Escape close, scroll lock, focus
 * trap and initial focus on the first focusable element (or `initialFocusRef`).
 * Extracted from the DeployWizard's hand-rolled implementation so every
 * dialog in the app gets the same accessibility guarantees.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  initialFocusRef,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // The panel ref is always attached before this effect runs (refs bind
    // during commit, effects after), so the element is safe to assert.
    const panel = panelRef.current!;
    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
        (el) => !(el as HTMLButtonElement).disabled,
      );

    const target = initialFocusRef?.current ?? focusables()[0];
    target?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        // The header close button is always focusable, so the list is never empty.
        const els = focusables();
        const first = els[0]!;
        const last = els[els.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, initialFocusRef]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button type="button" aria-label="Close dialog" tabIndex={-1} aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'nd-fade relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-slate-950 shadow-2xl sm:rounded-2xl',
          wide ? 'max-w-3xl' : 'max-w-xl',
        )}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-white/5 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// ── Confirm dialog ────────────────────────────────────────────────────────
/**
 * The single destructive-action pattern for the whole app:
 * - confirm = 'dialog' (default): small danger modal with a Cancel/Confirm pair.
 * - confirm = 'type': type-the-name confirmation for irreversible damage
 *   (deleting services, volumes).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  confirmWord,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  confirmWord?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [word, setWord] = useState('');
  // Reset the typed confirmation whenever the dialog reopens.
  useEffect(() => {
    if (open) setWord('');
  }, [open]);
  if (!open) return null;

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={confirmWord != null && word !== confirmWord} onClick={() => { onConfirm(); onClose(); }}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-300">{message}</div>
      {confirmWord != null && (
        <div className="mt-4">
          <Field label={`Type "${confirmWord}" to confirm`}>
            <Input value={word} onChange={(e) => setWord(e.target.value)} placeholder={confirmWord} autoComplete="off" />
          </Field>
        </div>
      )}
    </Modal>
  );
}

// ── Switch ────────────────────────────────────────────────────────────────
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-950',
        'disabled:opacity-50 disabled:pointer-events-none',
        checked ? 'bg-indigo-500' : 'bg-white/15',
      )}
    >
      <span className={cn('h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
    </button>
  );
}

// ── Page header ───────────────────────────────────────────────────────────
/**
 * Standard page chrome: icon + title + subtitle on the left, primary action
 * on the right. Every route uses this so margins and rhythm stay identical.
 */
export function PageHeader({ icon, title, subtitle, actions }: { icon?: ReactNode; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {icon && (
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-indigo-300 ring-1 ring-inset ring-white/10">{icon}</div>
        )}
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────
export function Table({ columns, children, className }: { columns: string[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-white/[0.08]', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.08] bg-white/[0.03]">
            {columns.map((c) => (
              <th key={c} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">{children}</tbody>
      </table>
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────
const TONES = {
  neutral: 'bg-white/[0.07] text-slate-300 ring-white/10',
  indigo: 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/20',
  emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/20',
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/20',
  rose: 'bg-rose-500/15 text-rose-300 ring-rose-500/20',
  sky: 'bg-sky-500/15 text-sky-300 ring-sky-500/20',
} as const;

export function Badge({ tone = 'neutral', className, children }: { tone?: keyof typeof TONES; className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>{children}</span>;
}

// ── Stat card ─────────────────────────────────────────────────────────────
export function StatCard({ icon, label, value, hint }: { icon?: ReactNode; label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card>
      <CardBody className="p-4">
        <div className="flex items-center gap-2 text-slate-400">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </CardBody>
    </Card>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────
/** Minimal CSS-only tooltip: wraps children, shows `content` on hover/focus. */
export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-2 left-1/2 z-40 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}
