import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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

    it('focuses a single service and resets back to the full graph', async () => {
      mockOf(api.topology.get).mockResolvedValue(graph as never);
      renderWithProviders(<Topology />);
      await screen.findByTestId('react-flow');
      // full graph: 2 services + 2 dbs + domain + gateway + volumes + network
      const full = Number((await screen.findByTestId('react-flow')).getAttribute('data-nodes'));

      // pick "worker" (id 2): no domains, no attachments, no volumes of its own
      fireEvent.change(screen.getByLabelText('Focus service'), { target: { value: '2' } });
      await waitFor(() => {
        const focused = Number(screen.getByTestId('react-flow').getAttribute('data-nodes'));
        expect(focused).toBeLessThan(full);
        // worker node present; api's domain/db/volume gone
        expect(screen.getByTestId('react-flow')).toHaveTextContent('worker');
        expect(screen.getByTestId('react-flow')).not.toHaveTextContent('app.example.com');
        expect(screen.getByTestId('react-flow')).not.toHaveTextContent('db-main');
        expect(screen.getByTestId('react-flow')).not.toHaveTextContent('api-data');
      });

      // reset restores the full graph (both the button and the '' option)
      fireEvent.click(screen.getByRole('button', { name: 'reset' }));
      await waitFor(() =>
        expect(Number(screen.getByTestId('react-flow').getAttribute('data-nodes'))).toBe(full),
      );

      // focusing a service WITH an attachment keeps its database + volumes
      fireEvent.change(screen.getByLabelText('Focus service'), { target: { value: '1' } });
      await waitFor(() => {
        const flow = screen.getByTestId('react-flow');
        expect(flow).toHaveTextContent('db-main');
        expect(flow).toHaveTextContent('api-data');
        expect(flow).not.toHaveTextContent('cache'); // unattached db filtered out
        expect(flow).not.toHaveTextContent('worker');
      });

      // picking an id that vanished from the graph falls back to the full view
      fireEvent.change(screen.getByLabelText('Focus service'), { target: { value: '999' } });
      await waitFor(() =>
        expect(Number(screen.getByTestId('react-flow').getAttribute('data-nodes'))).toBe(full),
      );
      // selecting the empty option also clears the focus
      fireEvent.change(screen.getByLabelText('Focus service'), { target: { value: '2' } });
      await waitFor(() =>
        expect(Number(screen.getByTestId('react-flow').getAttribute('data-nodes'))).toBeLessThan(full),
      );
      fireEvent.change(screen.getByLabelText('Focus service'), { target: { value: '' } });
      await waitFor(() =>
        expect(Number(screen.getByTestId('react-flow').getAttribute('data-nodes'))).toBe(full),
      );
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
      expect(screen.getByTestId('react-flow')).toHaveTextContent('api');
      expect(screen.getByTestId('react-flow')).toHaveTextContent('worker');
      expect(screen.getByTestId('react-flow')).toHaveTextContent('db-main');
      expect(screen.getByTestId('react-flow')).toHaveTextContent('cache');
      expect(screen.getByTestId('react-flow')).toHaveTextContent('app.example.com');
      expect(screen.getByTestId('react-flow')).toHaveTextContent('Traefik');
      expect(screen.getByTestId('react-flow')).toHaveTextContent('ninedeploy');
      // volume names are shortened (nd-svc-/-data stripped); orphan is kept
      expect(screen.getByTestId('react-flow')).toHaveTextContent('api-data');
      expect(screen.getByTestId('react-flow')).toHaveTextContent('ghost-data');
      expect(screen.getAllByText('postgres').length).toBeGreaterThan(0);
      expect(screen.getAllByText('running').length).toBeGreaterThan(0);
    });
});
