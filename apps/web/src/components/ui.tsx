import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from 'react';

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
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%)',
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
    'text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:brightness-110 [background-image:linear-gradient(135deg,#6366f1,#8b5cf6)]',
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
export function Card({ className, children, interactive }: { className?: string; children: ReactNode; interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-white/[0.08] bg-white/[0.025] backdrop-blur-sm',
        interactive && 'transition-all duration-200 hover:border-white/15 hover:bg-white/[0.04] hover:shadow-xl hover:shadow-black/40',
        className,
      )}
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

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {children}
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
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" width="1em" height="1em">
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
