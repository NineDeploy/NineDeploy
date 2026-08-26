import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { About } from '../src/routes/About.js';
import { api } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  // Must be './apiMock.js', not './helpers.js' â€” see the note in apiMock.ts.
  const { createFakeApiModule } = await import('./apiMock.js');
  return createFakeApiModule();
});

const aboutData = {
  name: 'NineDeploy',
  version: '0.0.1',
  description: 'Self-hosted deploys',
  license: 'MIT',
  repo: 'https://github.com/ninedeploy/ninedeploy',
  docs: 'https://docs.example.com',
  techStack: [
    { category: 'Runtime', items: ['Node.js', 'Fastify'] },
    { category: 'Containers', items: ['Docker'] },
  ],
  changelog: [
    { version: '0.0.1', date: '2026-01-01', title: 'First release', changes: ['Initial commit', 'More stuff'] },
  ],
  stats: { services: 3, databases: 2, deployments: 9, users: 1, plugins: 5 },
};

describe('About', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows skeleton while loading', () => {
    mockOf(api.about.get).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<About />);
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('returns null when there is no data', async () => {
    mockOf(api.about.get).mockResolvedValue(null as never);
    const { container } = renderWithProviders(<About />);
    // wait for the query to settle (loading skeleton disappears)
    await waitFor(() => expect(container.querySelector('.animate-pulse')).toBeNull());
    expect(container.querySelector('.nd-fade')).toBeNull();
  });

  it('returns null when changelog is empty', async () => {
    mockOf(api.about.get).mockResolvedValue({ ...aboutData, changelog: [] } as never);
    const { container } = renderWithProviders(<About />);
    await waitFor(() => expect(container.querySelector('.animate-pulse')).toBeNull());
    expect(container.querySelector('.nd-fade')).toBeNull();
  });

  it('renders the full about page with badges, changelog, tech stack and links', async () => {
    mockOf(api.about.get).mockResolvedValue(aboutData as never);
    mockOf(api.system.updateCheck).mockResolvedValue({
      current: '0.0.1', latest: '0.0.1', updateAvailable: false, notesUrl: null, checkedAt: '2026-08-15T00:00:00Z',
    } as never);
    renderWithProviders(<About />);
    await screen.findByRole('heading', { name: 'NineDeploy' });
    expect(screen.getAllByText('v0.0.1').length).toBeGreaterThan(0);
    expect(screen.getByText('MIT')).toBeInTheDocument();
    expect(screen.getAllByText('3 services').length).toBeGreaterThan(0);
    expect(screen.getByText('9 deploys')).toBeInTheDocument();
    expect(screen.getByText('2 databases')).toBeInTheDocument();
    expect(screen.getByText('1 users')).toBeInTheDocument();
    expect(screen.getByText('5 plugins')).toBeInTheDocument();
    expect(screen.getByText("What's New â€” v0.0.1")).toBeInTheDocument();
    expect(screen.getByText('First release')).toBeInTheDocument();
    expect(screen.getByText('Initial commit')).toBeInTheDocument();
    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getByText('Node.js')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', aboutData.repo);
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', aboutData.docs);
    expect(screen.getByText(/install\.sh/)).toBeInTheDocument();
    expect(screen.getByText(/You're running/)).toBeInTheDocument();
    expect(screen.getAllByText(/latest release/i).length).toBeGreaterThan(0);
  });

  it('shows the update badge when a newer release is available', async () => {
    mockOf(api.about.get).mockResolvedValue(aboutData as never);
    mockOf(api.system.updateCheck).mockResolvedValue({
      current: '0.0.1', latest: '0.1.0', updateAvailable: true,
      notesUrl: 'https://github.com/ninedeploy/ninedeploy/releases/tag/v0.1.0',
      checkedAt: '2026-08-15T00:00:00Z',
    } as never);
    renderWithProviders(<About />);
    await screen.findByRole('heading', { name: 'NineDeploy' });
    // The update query resolves in a second paint â€” poll the DOM for the badge.
    for (let i = 0; i < 40; i++) {
      const el = document.querySelector<HTMLAnchorElement>('[title^="Upgrade to"]');
      if (el) {
        expect(el).toHaveAttribute('href', 'https://github.com/ninedeploy/ninedeploy/releases/tag/v0.1.0');
        expect(screen.getByText(/A new release is out/)).toBeInTheDocument();
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('update badge did not render');
  });

  it('degrades gracefully when the update check is unavailable', async () => {
    mockOf(api.about.get).mockResolvedValue(aboutData as never);
    mockOf(api.system.updateCheck).mockResolvedValue({
      current: '0.0.1', latest: null, updateAvailable: null, notesUrl: null, checkedAt: '2026-08-15T00:00:00Z',
    } as never);
    renderWithProviders(<About />);
    expect(await screen.findByText(/Update check unavailable/)).toBeInTheDocument();
  });

  it('shows the update skeleton while the check is in flight and hides the badge', async () => {
    mockOf(api.about.get).mockResolvedValue(aboutData as never);
    mockOf(api.system.updateCheck).mockReturnValue(new Promise(() => {}) as never);
    renderWithProviders(<About />);
    await screen.findByRole('heading', { name: 'NineDeploy' });
    expect(document.querySelector('[title^="Upgrade to"]')).toBeNull();
    expect(await screen.findByText(/To upgrade/i)).toBeInTheDocument();
  });

  it('falls back to the about version when the update check fails', async () => {
    mockOf(api.about.get).mockResolvedValue(aboutData as never);
    mockOf(api.system.updateCheck).mockRejectedValue(new Error('offline') as never);
    renderWithProviders(<About />);
    expect(await screen.findByText(/You're running/)).toBeInTheDocument();
    expect(screen.queryByText(/Update check unavailable/)).not.toBeInTheDocument();
  });

  it('links the badge to the tag page when the feed gave no notes URL', async () => {
    mockOf(api.about.get).mockResolvedValue(aboutData as never);
    mockOf(api.system.updateCheck).mockResolvedValue({
      current: '0.0.1', latest: '0.1.0', updateAvailable: true, notesUrl: null, checkedAt: '2026-08-15T00:00:00Z',
    } as never);
    renderWithProviders(<About />);
    await screen.findByRole('heading', { name: 'NineDeploy' });
    for (let i = 0; i < 40; i++) {
      const el = document.querySelector<HTMLAnchorElement>('[title^="Upgrade to"]');
      if (el) {
        expect(el).toHaveAttribute('href', '0.1.0');
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('update badge did not render');
  });
});
