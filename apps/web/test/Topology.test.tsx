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
  Position: { Left: 'left', Right: 'right' },
}));

const graph = {
  services: [
    { id: 1, name: 'api', status: 'running', type: 'docker' },
    { id: 2, name: 'worker', status: 'stopped', type: 'pm2' },
  ],
  databases: [
    { id: 5, name: 'db-main', status: 'running', engine: 'postgres' },
    { id: 6, name: 'cache', status: 'error', engine: 'redis' },
  ],
  domains: [
    { id: 10, serviceId: 1, hostname: 'app.example.com' },
    { id: 11, serviceId: 99, hostname: 'orphan.example.com' }, // serviceId not in graph -> skipped
  ],
  attachments: [
    { id: 20, serviceId: 1, databaseId: 5, envAlias: 'DATABASE_URL' },
  ],
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
    mockOf(api.topology.get).mockResolvedValue({ services: [], databases: [], domains: [], attachments: [] } as never);
    renderWithProviders(<Topology />);
    await screen.findByText('Nothing deployed yet.');
  });

  it('renders nodes and edges computed from the graph', async () => {
    mockOf(api.topology.get).mockResolvedValue(graph as never);
    renderWithProviders(<Topology />);
    const flow = await screen.findByTestId('react-flow');
    // 2 services + 2 databases + 1 domain (orphan skipped)
    expect(flow.getAttribute('data-nodes')).toBe('5');
    // 1 domain edge + 1 attachment edge
    expect(flow.getAttribute('data-edges')).toBe('2');
    expect(screen.getByTestId('flow-provider')).toBeInTheDocument();
    expect(screen.getByTestId('background')).toBeInTheDocument();
    expect(screen.getByTestId('controls')).toBeInTheDocument();
    // node components rendered via nodeTypes with their data
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.getByText('worker')).toBeInTheDocument();
    expect(screen.getByText('db-main')).toBeInTheDocument();
    expect(screen.getByText('cache')).toBeInTheDocument();
    expect(screen.getByText('app.example.com')).toBeInTheDocument();
    expect(screen.getAllByText('postgres').length).toBeGreaterThan(0);
    expect(screen.getAllByText('running').length).toBeGreaterThan(0);
  });
});
