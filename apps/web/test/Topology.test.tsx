import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Topology } from '../src/routes/Topology.js';
import { api } from '../src/lib/api.js';
import { renderWithProviders, mockOf } from './helpers.js';

vi.mock('../src/lib/api.js', async () => {
  const { createFakeApiModule } = await import('./helpers.js');
  return createFakeApiModule();
});

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges, nodeTypes, children }: { nodes: Array<{ id: string; type: string; data: unknown }>; edges: unknown[]; nodeTypes?: Record<string, React.ComponentType<{ id: string; data: unknown }>>; children: React.ReactNode }) => (
    <div data-testid="react-flow" data-nodes={nodes.length} data-edges={edges.length}>
      {nodes.map((n) => {
        const NodeComp = nodeTypes?.[n.type];
        return NodeComp ? <NodeComp key={n.id} id={n.id} data={n.data} /> : null;
      })}
      {children}
    </div>
  ),
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="flow-provider">{children}</div>,
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  Handle: () => <div data-testid="handle" />,
  BackgroundVariant: { Dots: 'dots' },
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

const graph = {
  services: [
    { id: 1, name: 'api', status: 'running', type: 'docker', image: null, port: 3000, runtimeId: 'api-1', volumeMount: null },
    { id: 2, name: 'worker', status: 'stopped', type: 'pm2', image: null, port: null, runtimeId: null, volumeMount: null },
  ],
  databases: [
    { id: 5, name: 'db-main', status: 'running', engine: 'postgres', host: 'nd-db-db-main' },
    { id: 6, name: 'cache', status: 'error', engine: 'redis', host: null },
  ],
  domains: [
    { id: 10, serviceId: 1, hostname: 'app.example.com', ssl: true },
    { id: 11, serviceId: 99, hostname: 'orphan.example.com', ssl: false }, // serviceId not in graph -> skipped
  ],
  attachments: [
    { id: 20, serviceId: 1, databaseId: 5, envAlias: 'DATABASE_URL' },
  ],
  volumes: [
    { name: 'nd-svc-api-data', owner: { kind: 'service', refId: 1, name: 'api' } },
    { name: 'nd-db-db-main-data', owner: { kind: 'database', refId: 5, name: 'db-main', engine: 'postgres' } },
    { name: 'nd-svc-ghost-data', owner: null }, // orphaned volume
  ],
  networks: [
    { name: 'ninedeploy', driver: 'bridge', containers: ['api-1', 'ninedeploy-traefik'] }, // gateway member -> skipped
  ],
  gateway: { name: 'ninedeploy-traefik', network: 'ninedeploy', running: true },
};

describe('Topology', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

it('shows an error state with retry when the graph query fails', async () => {
    mockOf(api.topology.get).mockRejectedValue(new Error('boom'));
    renderWithProviders(<Topology />);
    expect(await screen.findByText(/Couldn't load the topology/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(api.topology.get).toHaveBeenCalledTimes(2);
  });

    it('shows loading state while fetching the graph', () => {
      mockOf(api.topology.get).mockReturnValue(new Promise(() => {}));
      renderWithProviders(<Topology />);
      expect(screen.getByText('Loading graph…')).toBeInTheDocument();
    });

    it('shows empty state when nothing is deployed', async () => {
      mockOf(api.topology.get).mockResolvedValue({ services: [], databases: [], domains: [], attachments: [], volumes: [], networks: [], gateway: { name: 'ninedeploy-traefik', network: 'ninedeploy', running: false } } as never);
      renderWithProviders(<Topology />);
      await screen.findByText('Nothing deployed yet.');
    });

    it('renders the gateway stopped state when traefik is down', async () => {
      mockOf(api.topology.get).mockResolvedValue({
        ...graph,
        domains: [{ id: 12, serviceId: 1, hostname: 'plain.example.com', ssl: false }],
        gateway: { name: 'ninedeploy-traefik', network: 'ninedeploy', running: false },
      } as never);
      renderWithProviders(<Topology />);
      await screen.findByText('Traefik');
      // gateway status badge falls back to 'stopped' when not running
      // both the gateway badge and the stopped worker service render 'stopped'
      expect(screen.getAllByText('stopped').length).toBeGreaterThanOrEqual(2);
    });

    it('renders nodes and edges computed from the graph', async () => {
      mockOf(api.topology.get).mockResolvedValue(graph as never);
      renderWithProviders(<Topology />);
      const flow = await screen.findByTestId('react-flow');
      // 2 services + 2 databases + 1 domain (orphan skipped) + 1 gateway + 2 volumes + 1 network
      expect(flow.getAttribute('data-nodes')).toBe('10');
      // 1 domain→gateway + 1 gateway→service + 1 attachment + 1 volume + 1 network link
      expect(flow.getAttribute('data-edges')).toBe('6');
      expect(screen.getByTestId('flow-provider')).toBeInTheDocument();
      expect(screen.getByTestId('background')).toBeInTheDocument();
      expect(screen.getByTestId('controls')).toBeInTheDocument();
      // node components rendered via nodeTypes with their data
      expect(screen.getByText('api')).toBeInTheDocument();
      expect(screen.getByText('worker')).toBeInTheDocument();
      expect(screen.getByText('db-main')).toBeInTheDocument();
      expect(screen.getByText('cache')).toBeInTheDocument();
      expect(screen.getByText('app.example.com')).toBeInTheDocument();
      expect(screen.getByText('Traefik')).toBeInTheDocument();
      expect(screen.getByText('ninedeploy')).toBeInTheDocument();
      // volume names are shortened (nd-svc-/-data stripped); orphan is kept
      expect(screen.getByText('api-data')).toBeInTheDocument();
      expect(screen.getByText('ghost-data')).toBeInTheDocument();
      expect(screen.getAllByText('postgres').length).toBeGreaterThan(0);
      expect(screen.getAllByText('running').length).toBeGreaterThan(0);
    });
});
