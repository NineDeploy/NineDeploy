import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { DockerDashboard } from '../src/routes/Docker.js';
import { api } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

const resources = {
  containers: 7,
  volumes: 3,
  imagesSummary: { total: 12, active: 9, reclaimable: 3 },
  network: 'ninedeploy',
  images: [
    { repo: 'nginx', tag: 'latest', size: '190 MB' },
    { repo: 'postgres', tag: '16', size: '430 MB' },
  ],
};

const events = {
  events: [
    { time: '1786000000', type: 'container', action: 'start', name: 'nd-web-3', actor: 'ninedeploy' },
    { time: 'not-a-number', type: 'image', action: 'pull', name: 'nginx:latest', actor: '' },
  ],
};

describe('DockerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOf(api.system.resources).mockResolvedValue(resources as never);
    mockOf(api.system.dockerEvents).mockResolvedValue(events as never);
  });

  it('renders the resource cards, image list and event feed', async () => {
    renderWithProviders(<DockerDashboard />);
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText(/9 active · 3 reclaimable/)).toBeInTheDocument();
    expect(screen.getByText('ninedeploy')).toBeInTheDocument();
    expect(screen.getAllByText('nginx').length).toBeGreaterThan(0);
    expect(await screen.findByText('nd-web-3')).toBeInTheDocument();
    // Non-numeric event timestamps fall back to the raw string.
    expect(screen.getByText('not-a-number')).toBeInTheDocument();
    expect(api.system.dockerEvents).toHaveBeenCalledWith(60);
  });

  it('shows skeletons while loading and empty states without data', async () => {
    mockOf(api.system.resources).mockReturnValue(new Promise(() => {}));
    mockOf(api.system.dockerEvents).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<DockerDashboard />);
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders empty-state variants', async () => {
    mockOf(api.system.resources).mockResolvedValue({ ...resources, images: [] } as never);
    mockOf(api.system.dockerEvents).mockResolvedValue({ events: [] } as never);
    renderWithProviders(<DockerDashboard />);
    expect(await screen.findByText('No images.')).toBeInTheDocument();
    expect(await screen.findByText('No recent events')).toBeInTheDocument();
  });
});
