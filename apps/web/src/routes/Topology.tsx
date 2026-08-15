import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Database, Globe, Server } from 'lucide-react';
import { api } from '../lib/api.js';
import { ErrorCard, PageHeader, StatusBadge } from '../components/ui.js';

const SERVICE_X = 380;
const DB_X = 780;
const DOMAIN_X = 30;
const GAP = 132;

type ServiceData = { name: string; status: string; type: string };
type DatabaseData = { name: string; status: string; engine: string };
type DomainData = { hostname: string };

function ServiceNode(props: NodeProps) {
  const data = props.data as ServiceData;
  return (
    <div className="w-52 rounded-xl border border-indigo-500/30 bg-slate-900/90 px-3 py-2.5 shadow-lg shadow-black/40 backdrop-blur">
      <Handle type="target" position={Position.Left} style={{ background: 'var(--nd-accent)' }} />
      <Handle type="source" position={Position.Right} style={{ background: 'var(--nd-accent)' }} />
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300">
          <Server size={14} />
        </span>
        <span className="truncate font-medium text-slate-100">{data.name}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase text-slate-500">{data.type}</span>
        <StatusBadge status={data.status} />
      </div>
    </div>
  );
}

function DatabaseNode(props: NodeProps) {
  const data = props.data as DatabaseData;
  return (
    <div className="w-48 rounded-xl border border-emerald-500/30 bg-slate-900/90 px-3 py-2.5 shadow-lg shadow-black/40 backdrop-blur">
      <Handle type="target" position={Position.Left} style={{ background: '#10b981' }} />
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300">
          <Database size={14} />
        </span>
        <span className="truncate font-medium text-slate-100">{data.name}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] capitalize text-slate-500">{data.engine}</span>
        <StatusBadge status={data.status} />
      </div>
    </div>
  );
}

function DomainNode(props: NodeProps) {
  const data = props.data as DomainData;
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/80 px-2.5 py-1.5 shadow backdrop-blur">
      <Handle type="source" position={Position.Right} style={{ background: '#64748b' }} />
      <div className="flex items-center gap-1.5">
        <Globe size={12} className="text-slate-500" />
        <span className="font-mono text-[11px] text-slate-300">{data.hostname}</span>
      </div>
    </div>
  );
}

const nodeTypes = { service: ServiceNode, database: DatabaseNode, domain: DomainNode };

export function Topology() {
  const graph = useQuery({ queryKey: ['topology'], queryFn: () => api.topology.get() });

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const g = graph.data;

    const services = g?.services ?? [];
    const databases = g?.databases ?? [];

    // Domains on the far left, grouped near their service's y.
    const svcIndex = new Map<number, number>();
    services.forEach((s, i) => {
      svcIndex.set(s.id, i);
    });
    const domainCountBySvc = new Map<number, number>();
    (g?.domains ?? []).forEach((d) => {
      const si = svcIndex.get(d.serviceId);
      if (si == null) return;
      const n = domainCountBySvc.get(d.serviceId) ?? 0;
      domainCountBySvc.set(d.serviceId, n + 1);
      const y = si * GAP + n * 52;
      nodes.push({ id: `domain-${d.id}`, type: 'domain', position: { x: DOMAIN_X, y }, data: { hostname: d.hostname } });
      edges.push({ id: `e-dom-${d.id}`, source: `domain-${d.id}`, target: `service-${d.serviceId}`, style: { stroke: '#475569' } });
    });

    // Services in the middle column.
    services.forEach((s, i) => {
      nodes.push({
        id: `service-${s.id}`,
        type: 'service',
        position: { x: SERVICE_X, y: i * GAP },
        data: { name: s.name, status: s.status, type: s.type },
      });
    });

    // Databases on the right.
    databases.forEach((d, i) => {
      nodes.push({
        id: `database-${d.id}`,
        type: 'database',
        position: { x: DB_X, y: i * GAP },
        data: { name: d.name, status: d.status, engine: d.engine },
      });
    });

    // Attachments → edges service → database.
    (g?.attachments ?? []).forEach((a) => {
      edges.push({
        id: `e-att-${a.id}`,
        source: `service-${a.serviceId}`,
        target: `database-${a.databaseId}`,
        label: a.envAlias,
        labelStyle: { fill: '#cbd5e1', fontSize: 10, fontFamily: 'monospace' },
        labelBgStyle: { fill: '#0f172a' },
        style: { stroke: '#10b981' },
        animated: true,
      });
    });

    return { nodes, edges };
  }, [graph.data]);

  return (
    <div>
      <PageHeader title="Topology" subtitle="How services, databases and domains connect." />

      <div className="nd-fade h-[72vh] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40">
        {graph.isLoading ? (
          <div className="grid h-full place-items-center text-sm text-slate-500">Loading graph…</div>
        ) : graph.isError ? (
          <div className="grid h-full place-items-center">
            <ErrorCard title="Couldn't load the topology" error={graph.error} onRetry={() => graph.refetch()} />
          </div>
        ) : nodes.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-slate-500">Nothing deployed yet.</div>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ style: { stroke: '#475569' } }}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e293b" />
              <Controls className="!border-white/10 !bg-slate-900/80" showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}
