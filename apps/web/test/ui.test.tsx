import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import './web-utils.js';
import {
  BrandMark,
  Button,
  Card,
  CardBody,
  EmptyState,
  Field,
  FullScreenSpinner,
  Input,
  Select,
  Skeleton,
  Spinner,
  StatusBadge,
  Tabs,
  Textarea,
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
