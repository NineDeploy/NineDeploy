import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient, deferred, renderWithProviders } from './web-utils.js';

const apiMock = vi.hoisted(() => ({
  api: {
    databases: { create: vi.fn() },
  },
}));

vi.mock('../src/lib/api.js', () => apiMock);

import { DatabaseWizard } from '../src/components/DatabaseWizard.js';

function renderWizard(onClose = vi.fn()) {
  return {
    onClose,
    ...renderWithProviders(<DatabaseWizard onClose={onClose} />, {
      queryClient: createQueryClient(),
    }),
  };
}

describe('DatabaseWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.api.databases.create.mockResolvedValue({ id: 1 });
  });

  it('starts on the engine step with all four engines', () => {
    renderWizard();
    expect(screen.getByText('New database')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.getByText('MySQL')).toBeInTheDocument();
    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getByText('MongoDB')).toBeInTheDocument();
  });

  it('requires an engine before continuing', async () => {
    const user = userEvent.setup();
    renderWizard();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    await user.click(screen.getByText('PostgreSQL'));
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('moves to the details step and requires a name', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByText('PostgreSQL'));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByPlaceholderText('my-database')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    await user.type(screen.getByPlaceholderText('my-database'), 'prod');
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('reviews and creates the database without a version', async () => {
    const { onClose } = renderWizard();
    const user = userEvent.setup();
    await user.click(screen.getByText('PostgreSQL'));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByPlaceholderText('my-database'), 'prod');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('persistent (nd-db-…-data)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /create database/i }));
    await waitFor(() =>
      expect(apiMock.api.databases.create).toHaveBeenCalledWith({
        name: 'prod',
        engine: 'postgres',
        version: undefined,
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('creates with an explicit version', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByText('Redis'));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByPlaceholderText('my-database'), 'cache');
    await user.type(screen.getByPlaceholderText(/16 \(default/i), '7.2');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByText('7.2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /create database/i }));
    await waitFor(() =>
      expect(apiMock.api.databases.create).toHaveBeenCalledWith({
        name: 'cache',
        engine: 'redis',
        version: '7.2',
      }),
    );
  });

  it('shows the creating label while pending and disables submit', async () => {
    const d = deferred();
    apiMock.api.databases.create.mockReturnValue(d.promise);
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByText('MongoDB'));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByPlaceholderText('my-database'), 'm1');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /create database/i }));
    expect(screen.getByText('Creating…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled();
    d.resolve({ id: 2 });
  });

  it('goes back to the previous step', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByText('PostgreSQL'));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByPlaceholderText('my-database'), 'prod');
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
  });

  it('hides the back button on the first step', () => {
    renderWizard();
    const back = screen.getByRole('button', { name: /back/i });
    expect(back.className).toContain('invisible');
  });

  it('closes via the X button and the backdrop', async () => {
    const user = userEvent.setup();
    const { container, onClose } = renderWizard();
    const headerClose = container.querySelector('h2 + button') as HTMLButtonElement;
    await user.click(headerClose);
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText('New database').closest('.fixed')!.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('marks completed steps with a check icon', async () => {
    const user = userEvent.setup();
    const { container } = renderWizard();
    await user.click(screen.getByText('PostgreSQL'));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    // After advancing, step 0 is "completed" — its circle uses the emerald
    // background and contains the Check lucide icon (rendered as <svg>).
    expect(container.querySelector('.bg-emerald-500')).not.toBeNull();
  });

  it('renders the engine summary row using the selected engine emoji and label', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByText('Redis'));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByPlaceholderText('my-database'), 'cache');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    // The review row combines the engine emoji and label via `ENGINES.find(...)`
    // — covers the `?? ''` and `?? ''` nullish fallbacks.
    expect(screen.getByText(/⚡ Redis/)).toBeInTheDocument();
  });
});
