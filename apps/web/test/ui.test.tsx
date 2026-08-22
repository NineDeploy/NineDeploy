import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import './web-utils.js';
import { rejectPanelAutofill } from '../src/lib/autofill.js';
import {
  AutofillRejectingInput,
  Badge,
  BrandMark,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  ErrorCard,
  Field,
  FullScreenSpinner,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Spinner,
  StatCard,
  StatusBadge,
  Switch,
  Table,
  Tabs,
  Textarea,
  Tooltip,
  cn,
} from '../src/components/ui.js';

describe('cn', () => {
  it('joins truthy parts and drops falsy ones', () => {
    expect(cn('a', false, 'b', null, undefined, 'c')).toBe('a b c');
  });

  it('returns an empty string for all-falsy input', () => {
    expect(cn(false, null)).toBe('');
  });
});

describe('BrandMark', () => {
  it('renders the 9 glyph with default size', () => {
    render(<BrandMark />);
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('9').style.width).toBe('28px');
  });

  it('honors a custom size', () => {
    render(<BrandMark size={48} />);
    const mark = screen.getByText('9');
    expect(mark.style.width).toBe('48px');
    expect(mark.style.height).toBe('48px');
  });
});

describe('Button', () => {
  it('renders with default variant/size classes and children', () => {
    render(<Button>Go</Button>);
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn).toBeInTheDocument();
    expect(btn.className).toContain('text-white');
    expect(btn.className).toContain('h-10');
  });

  it('applies variant and size classes', () => {
    render(
      <Button variant="danger" size="sm">
        Del
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Del' });
    expect(btn.className).toContain('bg-rose-500/90');
    expect(btn.className).toContain('h-8');
  });

  it('renders ghost and secondary variants', () => {
    const { rerender } = render(
      <Button variant="ghost" size="lg">
        g
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'g' }).className).toContain('text-slate-300');
    rerender(
      <Button variant="secondary">
        s
      </Button>,
    );
    expect(screen.getByRole('button', { name: 's' }).className).toContain('bg-white/[0.06]');
  });

  it('merges className and honors disabled state', () => {
    render(
      <Button className="extra" disabled>
        x
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'x' });
    expect(btn.className).toContain('extra');
    expect(btn).toBeDisabled();
  });

  it('forwards the ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>r</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});

describe('Card / CardBody', () => {
  it('renders a non-interactive card', () => {
    render(<Card>hi</Card>);
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('hi').className).not.toContain('hover:shadow-xl');
  });

  it('renders an interactive card', () => {
    render(<Card interactive>hi</Card>);
    expect(screen.getByText('hi').className).toContain('hover:shadow-xl');
  });

  it('CardBody applies padding and children', () => {
    render(<CardBody>body</CardBody>);
    expect(screen.getByText('body').className).toContain('p-5');
  });
});

describe('Input / Textarea / Select', () => {
  it('renders an input with forwarded ref and className', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} className="mine" placeholder="p" />);
    const el = screen.getByPlaceholderText('p');
    expect(el).toBeInstanceOf(HTMLInputElement);
    expect(ref.current).toBe(el);
    expect(el.className).toContain('mine');
  });

  it('renders a textarea with forwarded ref', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} aria-label="notes" />);
    const el = screen.getByLabelText('notes');
    expect(el).toBeInstanceOf(HTMLTextAreaElement);
    expect(ref.current).toBe(el);
  });

  it('renders a select with options and forwarded ref', () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <Select ref={ref} aria-label="pick">
        <option value="a">A</option>
      </Select>,
    );
    const el = screen.getByLabelText('pick');
    expect(el).toBeInstanceOf(HTMLSelectElement);
    expect(ref.current).toBe(el);
    expect(el.className).toContain('appearance-none');
  });
});

describe('Field', () => {
  it('renders the label and children', () => {
    render(
      <Field label="Email">
        <input aria-label="Email" />
      </Field>,
    );
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders the optional hint next to the label', () => {
    render(
      <Field label="Token" hint="Found under Settings → API">
        <input aria-label="Token" />
      </Field>,
    );
    expect(screen.getByText('Found under Settings → API')).toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it.each(['running', 'idle', 'deploying', 'error', 'stopped', 'deleting', 'queued', 'building', 'failed', 'active'])(
    'renders the %s status with a tone class',
    (status) => {
      render(<StatusBadge status={status} />);
      const badge = screen.getByText(status);
      expect(badge).toBeInTheDocument();
      expect(badge.className).toContain('ring-1');
    },
  );

  it('falls back to the neutral tone for unknown statuses', () => {
    render(<StatusBadge status="weird" />);
    const badge = screen.getByText('weird');
    expect(badge.className).toContain('bg-slate-500/15');
  });
});

describe('Spinner / Skeleton / FullScreenSpinner', () => {
  it('renders a spinner svg with custom className', () => {
    const { container } = render(<Spinner className="big" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('class')).toContain('big');
  });

  it('renders a full-screen spinner', () => {
    const { container } = render(<FullScreenSpinner />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders a skeleton with custom className', () => {
    const { container } = render(<Skeleton className="w-1/2" />);
    expect(container.querySelector('div')?.className).toContain('w-1/2');
  });
});

describe('EmptyState', () => {
  it('renders title alone', () => {
    render(<EmptyState title="Nothing" />);
    expect(screen.getByText('Nothing')).toBeInTheDocument();
  });

  it('renders icon, hint and action when provided', () => {
    render(
      <EmptyState
        icon={<span>ic</span>}
        title="Nothing"
        hint="Try again"
        action={<button type="button">Act</button>}
      />,
    );
    expect(screen.getByText('ic')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument();
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta', count: 3 },
  ];

  it('marks the active tab and reports clicks on inactive ones', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="a" onChange={onChange} />);
    const alpha = screen.getByRole('tab', { name: /Alpha/ });
    expect(alpha).toHaveAttribute('aria-selected', 'true');
    const beta = screen.getByRole('tab', { name: /Beta/ });
    expect(beta).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('3')).toBeInTheDocument();
    await user.click(beta);
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('omits the count badge when no count is given', () => {
    render(<Tabs tabs={tabs} active="b" onChange={() => {}} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('ErrorCard', () => {
  it('renders a default message for non-Error values', () => {
    render(<ErrorCard error="boom" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Unexpected error')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('shows the Error message and a retry button', () => {
    const onRetry = vi.fn();
    render(<ErrorCard title="Load failed" error={new Error('network down')} onRetry={onRetry} />);
    expect(screen.getByText('Load failed')).toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Try again' });
    btn.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('Modal', () => {
  it('renders title, children and footer; closes via backdrop, Escape and X', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="My Dialog" onClose={onClose} footer={<Button>Save</Button>}>
        <p>Body text</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(screen.getByText('My Dialog')).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

    // Backdrop click closes (the backdrop button precedes the panel).
    (dialog.previousElementSibling as HTMLElement | null)!.click();
    expect(onClose).toHaveBeenCalledTimes(1);

    // Escape closes.
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);

    // Explicit X button closes.
    screen.getByRole('button', { name: 'Close dialog' }).click();
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('locks and restores body scroll while open', () => {
    const { unmount } = render(
      <Modal title="T" onClose={() => {}}>
        x
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('traps Tab focus inside the dialog', async () => {
    const user = userEvent.setup();
    render(
      <Modal title="T" onClose={() => {}}>
        <input aria-label="first" />
        <button type="button">second</button>
      </Modal>,
    );
    // Panel content is the first focusable after the close button; Tab from
    // the last element wraps back to the first.
    const second = screen.getByRole('button', { name: 'second' });
    second.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }));
  });

  it('wraps Shift+Tab from the first focusable to the last', async () => {
    const user = userEvent.setup();
    render(
      <Modal title="T" onClose={() => {}}>
        <input aria-label="first" />
        <button type="button">second</button>
      </Modal>,
    );
    const close = screen.getByRole('button', { name: 'Close dialog' });
    close.focus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'second' }));
  });

  it('lets Tab move naturally when focus is on a middle element', async () => {
    const user = userEvent.setup();
    render(
      <Modal title="T" onClose={() => {}}>
        <button type="button">one</button>
        <button type="button">two</button>
        <button type="button">three</button>
      </Modal>,
    );
    const two = screen.getByRole('button', { name: 'two' });
    two.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'three' }));
  });

  it('no-ops Tab when the dialog has no focusable children', async () => {
    const user = userEvent.setup();
    render(
      <Modal title="T" onClose={() => {}}>
        <p>plain text</p>
      </Modal>,
    );
    await user.tab();
    expect(screen.getByText('plain text')).toBeInTheDocument();
  });

  it('uses the wide layout and omits aria-label for non-string titles', () => {
    render(
      <Modal wide title={<em>Styled</em>} onClose={() => {}}>
        <p>w</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-w-3xl');
    expect(dialog).not.toHaveAttribute('aria-label');
  });

  it('focuses the element referenced by initialFocusRef on open', () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <Modal title="T" onClose={() => {}} initialFocusRef={ref}>
        <Input ref={ref} aria-label="target" />
      </Modal>,
    );
    expect(screen.getByLabelText('target')).toHaveFocus();
  });
});

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmDialog open={false} title="t" message="m" onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirms immediately without a confirm word', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog open title="Delete?" message="Sure?" onConfirm={onConfirm} onClose={onClose} />);
    screen.getByRole('button', { name: 'Delete' }).click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('requires typing the confirm word before enabling the danger button', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open title="Danger" message="no undo" confirmWord="myapp" onConfirm={onConfirm} onClose={() => {}} />,
    );
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn).toBeDisabled();
    await user.type(screen.getByPlaceholderText('myapp'), 'myap');
    expect(btn).toBeDisabled();
    await user.type(screen.getByPlaceholderText('myapp'), 'p');
    expect(btn).toBeEnabled();
    btn.click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('resets the typed word when reopened', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog open={false} title="t" message="m" confirmWord="zap" onConfirm={onConfirm} onClose={() => {}} />,
    );
    rerender(<ConfirmDialog open title="t" message="m" confirmWord="zap" onConfirm={onConfirm} onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText('zap'), 'zap');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    rerender(<ConfirmDialog open={false} title="t" message="m" confirmWord="zap" onConfirm={onConfirm} onClose={() => {}} />);
    rerender(<ConfirmDialog open title="t" message="m" confirmWord="zap" onConfirm={onConfirm} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});

describe('Switch', () => {
  it('toggles on click and reports the new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Auto-deploy" />);
    const sw = screen.getByRole('switch', { name: 'Auto-deploy' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('disables interaction when disabled', () => {
    render(<Switch checked onChange={() => {}} disabled label="d" />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});

describe('PageHeader', () => {
  it('renders icon, title, subtitle and actions', () => {
    render(
      <PageHeader icon={<span>ic</span>} title="Services" subtitle="All workloads" actions={<Button>New</Button>} />,
    );
    expect(screen.getByText('ic')).toBeInTheDocument();
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByText('All workloads')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('omits subtitle and actions when not provided', () => {
    const { container } = render(<PageHeader title="Bare" />);
    expect(container.firstElementChild!.className).toContain('mb-6');
  });
});

describe('Table', () => {
  it('renders column headers and body rows', () => {
    render(
      <Table columns={['Name', 'Status']}>
        <tr>
          <td>api</td>
          <td>running</td>
        </tr>
      </Table>,
    );
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'api' })).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it.each(['neutral', 'indigo', 'emerald', 'amber', 'rose', 'sky'] as const)('renders the %s tone', (tone) => {
    render(<Badge tone={tone}>{tone}</Badge>);
    expect(screen.getByText(tone).className).toContain('ring-1');
  });
});

describe('StatCard', () => {
  it('renders label, value, icon and hint', () => {
    render(<StatCard icon={<span>i</span>} label="CPU" value="42%" hint="of 8 cores" />);
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('of 8 cores')).toBeInTheDocument();
    expect(screen.getByText('i')).toBeInTheDocument();
  });
});

describe('Tooltip', () => {
  it('exposes content in a tooltip role tied to the trigger', () => {
    render(
      <Tooltip content="Helpful text">
        <button type="button">hover me</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Helpful text');
    expect(screen.getByRole('button', { name: 'hover me' })).toBeInTheDocument();
  });
});

describe('AutofillRejectingInput', () => {
  it('unlocks on keyboard interaction and forwards the onKeyDown prop', () => {
    const onKeyDown = vi.fn();
    render(<AutofillRejectingInput aria-label="kb" onKeyDown={onKeyDown} />);
    const field = screen.getByLabelText<HTMLInputElement>('kb');
    expect(field).toHaveAttribute('readonly');

    fireEvent.keyDown(field, { key: 'a' });
    expect(field).not.toHaveAttribute('readonly');
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('clears values reported by a detected browser autofill', () => {
    // The animation-event path itself cannot be delivered under jsdom (React
    // skips animation delegation there), so exercise the rejection directly.
    const onAutofillRejected = vi.fn();
    render(<AutofillRejectingInput aria-label="af" onAutofillRejected={onAutofillRejected} />);
    const field = screen.getByLabelText<HTMLInputElement>('af');
    field.value = 'injected';
    rejectPanelAutofill(field, onAutofillRejected);
    expect(field).toHaveValue('');
    expect(onAutofillRejected).toHaveBeenCalledTimes(1);
  });
});
