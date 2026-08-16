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
import { Database, Globe, HardDrive, Server, ShieldCheck, Waypoints } from 'lucide-react';
import { api } from '../lib/api.js';
import type { TopologyGraph } from '@ninedeploy/sdk';
import { ErrorCard, PageHeader, StatusBadge } from '../components/ui.js';

// Layered columns: domains | gateway | services | databases, with each
// service's volumes stacked directly underneath it and networks above.
const DOMAIN_X = 20;
const GATEWAY_X = 260;
const SERVICE_X = 520;
const DB_X = 940;
const NETWORK_X = SERVICE_X;
const GAP = 132;
const NODE_H = 64;
const STACK_GAP = 46;

type ServiceData = { name: string; status: string; type: string; image: string | null; port: number | null };
type DatabaseData = { name: string; status: string; engine: string };
type DomainData = { hostname: string; ssl?: boolean };
type VolumeData = { name: string };
type NetworkData = { name: string; containers: number };
type GatewayData = { running: boolean };

function ServiceNode(props: NodeProps) {
  const data = props.data as ServiceData;
  return (
    <div className="w-52 rounded-xl border border-indigo-500/30 bg-slate-900/90 px-3 py-2.5 shadow-lg shadow-black/40 backdrop-blur">
      <Handle type="target" position={Position.Left} style={{ background: 'var(--nd-accent)' }} />
      <Handle type="source" position={Position.Right} style={{ background: 'var(--nd-accent)' }} />
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ background: '#f59e0b' }} />
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300">
          <Server size={14} />
        </span>
        <span className="truncate font-medium text-slate-100">{data.name}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase text-slate-500">{data.port ? `${data.type}:${data.port}` : data.type}</span>
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
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ background: '#f59e0b' }} />
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
        <Globe size={12} className={data.ssl ? 'text-emerald-400' : 'text-slate-500'} />
        <span className="font-mono text-[11px] text-slate-300">{data.hostname}</span>
      </div>
    </div>
  );
}

function VolumeNode(props: NodeProps) {
  const data = props.data as VolumeData;
  return (
    <div className="rounded-lg border border-amber-500/25 bg-slate-900/80 px-2.5 py-1.5 shadow backdrop-blur">
      <Handle type="target" position={Position.Top} style={{ background: '#f59e0b' }} />
      <div className="flex items-center gap-1.5" title={data.name}>
        <HardDrive size={12} className="text-amber-400" />
        <span className="font-mono text-[11px] text-slate-300">{data.name.replace(/^(nd-(svc|db)-|-data$)/g, '')}</span>
      </div>
    </div>
  );
}

function NetworkNode(props: NodeProps) {
  const data = props.data as NetworkData;
  return (
    <div className="rounded-lg border border-sky-500/30 bg-slate-900/80 px-2.5 py-1.5 shadow backdrop-blur">
      <Handle type="source" position={Position.Bottom} style={{ background: '#0ea5e9' }} />
      <div className="flex items-center gap-1.5">
        <Waypoints size={12} className="text-sky-400" />
        <span className="font-mono text-[11px] text-slate-300">{data.name}</span>
        <span className="font-mono text-[10px] text-slate-500">×{data.containers}</span>
      </div>
    </div>
  );
}

function GatewayNode(props: NodeProps) {
  const data = props.data as GatewayData;
  return (
    <div className="w-40 rounded-xl border border-sky-500/30 bg-slate-900/90 px-3 py-2.5 shadow-lg shadow-black/40 backdrop-blur">
      <Handle type="target" position={Position.Left} style={{ background: '#0ea5e9' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#0ea5e9' }} />
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-500/15 text-sky-300">
          <ShieldCheck size={14} />
        </span>
        <span className="font-medium text-slate-100">Traefik</span>
      </div>
      <div className="mt-1.5 text-right">
        <StatusBadge status={data.running ? 'running' : 'stopped'} />
      </div>
    </div>
  );
}

const nodeTypes = {
  service: ServiceNode,
  database: DatabaseNode,
  domain: DomainNode,
  volume: VolumeNode,
  network: NetworkNode,
  gateway: GatewayNode,
};

export function Topology() {
  const graph = useQuery({ queryKey: ['topology'], queryFn: () => api.topology.get() });

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const g = graph.data;

    const services = g?.services ?? [];
    const databases = g?.databases ?? [];
    const volumes = g?.volumes ?? [];

    // ── Layout: row height per service scales with its stacked domains and
    // volumes so nothing ever overlaps, even with many domains per service.
    const domainsBySvc = new Map<number, TopologyGraph['domains']>();
    (g?.domains ?? []).forEach((d) => {
      const list = domainsBySvc.get(d.serviceId) ?? [];
      list.push(d);
      domainsBySvc.set(d.serviceId, list);
    });
    const volsByOwner = new Map<string, TopologyGraph['volumes']>();
    volumes.forEach((v) => {
      if (!v.owner) return;
      const key = `${v.owner.kind}-${v.owner.refId}`;
      const list = volsByOwner.get(key) ?? [];
      list.push(v);
      volsByOwner.set(key, list);
    });

    const svcY = new Map<number, number>();
    let y = 0;
    services.forEach((s) => {
      svcY.set(s.id, y);
      const domCount = domainsBySvc.get(s.id)?.length ?? 0;
      const volCount = volsByOwner.get(`service-${s.id}`)?.length ?? 0;
      y += Math.max(GAP, NODE_H + domCount * STACK_GAP, NODE_H + 30 + volCount * (STACK_GAP - 6));
    });
    const totalHeight = Math.max(y, databases.length * GAP);

    // Domains in the left column, stacked within their service's band.
    (g?.domains ?? []).forEach((d) => {
      const sy = svcY.get(d.serviceId);
      if (sy == null) return; // orphan domain → service gone, skip
      const idx = domainsBySvc.get(d.serviceId)!.findIndex((x) => x.id === d.id);
      nodes.push({
        id: `domain-${d.id}`,
        type: 'domain',
        position: { x: DOMAIN_X, y: sy + idx * STACK_GAP },
        data: { hostname: d.hostname, ssl: d.ssl },
      });
      // Routed through the gateway, not straight to the service.
      edges.push({ id: `e-dom-${d.id}`, source: `domain-${d.id}`, target: 'gateway', style: { stroke: '#475569' } });
    });

    // Traefik gateway between domains and services, vertically centered.
    // Only rendered when there's something to front (keeps empty state empty).
    if ((g?.domains ?? []).length > 0 || services.length > 0) {
      nodes.push({
        id: 'gateway',
        type: 'gateway',
        position: { x: GATEWAY_X, y: totalHeight / 2 - 32 },
        data: { running: g?.gateway?.running === true },
      });
      // Gateway → every routed (domain-bearing) service.
      for (const [sid] of domainsBySvc) {
        if (!services.some((s) => s.id === sid)) continue;
        edges.push({ id: `e-gw-${sid}`, source: 'gateway', target: `service-${sid}`, style: { stroke: '#0ea5e9', strokeDasharray: '4 3' } });
      }
    }

    // Services in the middle column; volumes stacked right beneath them.
    services.forEach((s) => {
      const sy = svcY.get(s.id)!;
      nodes.push({
        id: `service-${s.id}`,
        type: 'service',
        position: { x: SERVICE_X, y: sy },
        data: { name: s.name, status: s.status, type: s.type, image: s.image ?? null, port: s.port ?? null },
      });
      (volsByOwner.get(`service-${s.id}`) ?? []).forEach((v, i) => {
        const vid = `vol-${v.name}`;
        nodes.push({ id: vid, type: 'volume', position: { x: SERVICE_X + i * 140, y: sy + NODE_H + 26 }, data: { name: v.name } });
        edges.push({
          id: `e-${vid}`,
          source: `service-${s.id}`,
          sourceHandle: 'bottom',
          target: vid,
          style: { stroke: '#f59e0b', strokeDasharray: '3 3' },
        });
      });
    });

    // Databases on the right, aligned with the mean y of attached services.
    const attsByDb = new Map<number, TopologyGraph['attachments']>();
    (g?.attachments ?? []).forEach((a) => {
      const list = attsByDb.get(a.databaseId) ?? [];
      list.push(a);
      attsByDb.set(a.databaseId, list);
    });
    let dbY = 0;
    databases.forEach((d) => {
      const attached = (attsByDb.get(d.id) ?? []).map((a) => svcY.get(a.serviceId)).filter((v): v is number => v != null);
      const aligned = attached.length ? attached.reduce((a, b) => a + b, 0) / attached.length : null;
      const volCount = volsByOwner.get(`database-${d.id}`)?.length ?? 0;
      const dy = aligned != null ? Math.max(aligned - 20, dbY) : dbY;
      nodes.push({ id: `database-${d.id}`, type: 'database', position: { x: DB_X, y: dy }, data: { name: d.name, status: d.status, engine: d.engine } });
      dbY = dy + Math.max(GAP, NODE_H + 30 + volCount * (STACK_GAP - 6));
      (volsByOwner.get(`database-${d.id}`) ?? []).forEach((v, i) => {
        const vid = `vol-${v.name}`;
        nodes.push({ id: vid, type: 'volume', position: { x: DB_X + i * 140, y: dy + NODE_H + 26 }, data: { name: v.name } });
        edges.push({ id: `e-${vid}`, source: `database-${d.id}`, sourceHandle: 'bottom', target: vid, style: { stroke: '#f59e0b', strokeDasharray: '3 3' } });
      });
    });

    // Orphaned volumes (owner deleted, data retained) in a bottom-left stack.
    volumes
      .filter((v) => !v.owner)
      .forEach((v, i) => {
        nodes.push({ id: `vol-${v.name}`, type: 'volume', position: { x: DOMAIN_X, y: totalHeight + 60 + i * (STACK_GAP - 6) }, data: { name: v.name } });
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

    // Networks above the service column; dashed links into running containers.
    (g?.networks ?? []).forEach((n, i) => {
      nodes.push({ id: `net-${n.name}`, type: 'network', position: { x: NETWORK_X + i * 150, y: -120 }, data: { name: n.name, containers: n.containers.length } });
      n.containers.forEach((c) => {
        const target = services.find((s) => s.runtimeId === c);
        if (!target) return; // gateway/agent containers aren't service nodes
        edges.push({ id: `e-net-${n.name}-${c}`, source: `net-${n.name}`, target: `service-${target.id}`, style: { stroke: '#0ea5e9', strokeDasharray: '2 4' } });
      });
    });

    return { nodes, edges };
  }, [graph.data]);

  return (
    <div>
      <PageHeader title="Topology" subtitle="Domains, gateway, services, databases, volumes and networks — the whole picture." />

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
