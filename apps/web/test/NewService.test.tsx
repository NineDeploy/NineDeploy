import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { NewService } from '../src/routes/NewService.js';
import { api } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

function LocationProbe() {
  // renders the current pathname so navigation can be asserted
  return <div data-testid="location">{useLocation().pathname}</div>;
}

describe('NewService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the form with source options', async () => {
    mockOf(api.sources.list).mockResolvedValue([
      { id: 7, name: 'gh', type: 'github', hasToken: true, hasDeployKey: false },
    ] as never);
    renderWithProviders(
      <>
        <NewService />
        <LocationProbe />
      </>,
    );
    await screen.findByText('gh (github)');
    expect(screen.getByPlaceholderText('my-api')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://github.com/you/repo')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('3000')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('/app/data')).toBeInTheDocument();
  });

  it('creates a service with all fields filled and navigates', async () => {
    const user = userEvent.setup();
    mockOf(api.sources.list).mockResolvedValue([] as never);
    mockOf(api.services.create).mockResolvedValue({ id: 42, name: 'my-api' } as never);
    renderWithProviders(
      <>
        <NewService />
        <LocationProbe />
      </>,
    );
    await user.type(await screen.findByPlaceholderText('my-api'), 'my-api');
    await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'pm2');
    await user.type(screen.getByPlaceholderText('https://github.com/you/repo'), 'https://github.com/you/repo');
    const branchInput = screen.getByPlaceholderText('main');
    await user.clear(branchInput);
    await user.type(branchInput, 'develop');
    await user.type(screen.getByPlaceholderText('3000'), '8080');
    await user.type(screen.getByPlaceholderText('/app/data'), '/data');
    await user.click(screen.getByRole('button', { name: /Create service/ }));
    await waitFor(() =>
      expect(api.services.create).toHaveBeenCalledWith({
        name: 'my-api',
        type: 'pm2',
        repoUrl: 'https://github.com/you/repo',
        branch: 'develop',
        sourceId: undefined,
        port: 8080,
        volumeMount: '/data',
      }),
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/services/42'));
  });

  it('creates a service with a selected source id', async () => {
    const user = userEvent.setup();
    mockOf(api.sources.list).mockResolvedValue([{ id: 7, name: 'gh', type: 'github' }] as never);
    mockOf(api.services.create).mockResolvedValue({ id: 1 } as never);
    renderWithProviders(<NewService />);
    await user.type(await screen.findByPlaceholderText('my-api'), 's');
    await user.type(screen.getByPlaceholderText('https://github.com/you/repo'), 'https://x.com/y');
    await user.selectOptions(screen.getAllByRole('combobox')[1]!, '7');
    await user.click(screen.getByRole('button', { name: /Create service/ }));
    await waitFor(() =>
      expect(api.services.create).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: 7, port: undefined, volumeMount: undefined }),
      ),
    );
  });

  it('disables submit while fields are empty', async () => {
    mockOf(api.sources.list).mockResolvedValue([] as never);
    renderWithProviders(<NewService />);
    await screen.findByRole('button', { name: /Create service/ });
    expect(screen.getByRole('button', { name: /Create service/ })).toBeDisabled();
  });

  it('shows an error message when creation fails', async () => {
    const user = userEvent.setup();
    mockOf(api.sources.list).mockResolvedValue([] as never);
    mockOf(api.services.create).mockRejectedValue(new Error('repo not found'));
    renderWithProviders(<NewService />);
    await user.type(await screen.findByPlaceholderText('my-api'), 'x');
    await user.type(screen.getByPlaceholderText('https://github.com/you/repo'), 'https://github.com/nope');
    await user.click(screen.getByRole('button', { name: /Create service/ }));
    await screen.findByText('repo not found');
  });

  it('shows a generic error when the failure is not an Error instance', async () => {
    const user = userEvent.setup();
    mockOf(api.sources.list).mockResolvedValue([] as never);
    mockOf(api.services.create).mockRejectedValue('boom');
    renderWithProviders(<NewService />);
    await user.type(await screen.findByPlaceholderText('my-api'), 'x');
    await user.type(screen.getByPlaceholderText('https://github.com/you/repo'), 'https://github.com/nope');
    await user.click(screen.getByRole('button', { name: /Create service/ }));
    await screen.findByText('Could not create service');
  });
});
