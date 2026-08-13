import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { About } from '../src/routes/About.js';
import { api } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
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
  stats: { services: 3, databases: 2, deployments: 9, users: 1 },
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
    renderWithProviders(<About />);
    await screen.findByRole('heading', { name: 'NineDeploy' });
    expect(screen.getAllByText('v0.0.1').length).toBeGreaterThan(0);
    expect(screen.getByText('MIT')).toBeInTheDocument();
    expect(screen.getAllByText('3 services').length).toBeGreaterThan(0);
    expect(screen.getByText('9 deploys')).toBeInTheDocument();
    expect(screen.getByText('2 databases')).toBeInTheDocument();
    expect(screen.getByText('1 users')).toBeInTheDocument();
    expect(screen.getByText("What's New — v0.0.1")).toBeInTheDocument();
    expect(screen.getByText('First release')).toBeInTheDocument();
    expect(screen.getByText('Initial commit')).toBeInTheDocument();
    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getByText('Node.js')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', aboutData.repo);
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', aboutData.docs);
    expect(screen.getByText(/cd ninedeploy/)).toBeInTheDocument();
    expect(screen.getByText(/You're running/)).toBeInTheDocument();
  });
});
