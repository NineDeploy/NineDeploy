import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router';
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
  const serviceId = props.id.replace('service-', '');
  return (
    <div className="w-56 rounded-2xl border-2 border-indigo-500/40 bg-slate-900/95 p-3.5 shadow-xl shadow-black/50 backdrop-blur-md transition hover:border-indigo-400 hover:shadow-indigo-500/10">
      <Handle type="target" position={Position.Left} style={{ background: 'var(--nd-accent)' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#10b981' }} />
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ background: '#f59e0b' }} />
      <div className="flex items-center justify-between gap-2">
        <Link to={`/services/${serviceId}`} className="flex items-center gap-2 truncate hover:underline">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300">
            <Server size={15} />
          </span>
          <span className="truncate font-semibold text-slate-100 text-xs">{data.name}</span>
        </Link>
        <StatusBadge status={data.status} />
      </div>
      <div className="mt-2.5 flex items-center justify-between rounded-lg bg-white/[0.03] px-2 py-1 font-mono text-[10px]">
        <span className="uppercase text-slate-400">{data.type}</span>
        <span className="text-slate-200">:{data.port ?? '—'}</span>
      </div>
    </div>
  );
}

function DatabaseNode(props: NodeProps) {
  const data = props.data as DatabaseData;
  const dbId = props.id.replace('database-', '');
  return (
    <div className="w-52 rounded-2xl border-2 border-emerald-500/40 bg-slate-900/95 p-3.5 shadow-xl shadow-black/50 backdrop-blur-md transition hover:border-emerald-400 hover:shadow-emerald-500/10">
      <Handle type="target" position={Position.Left} style={{ background: '#10b981' }} />
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ background: '#f59e0b' }} />
      <div className="flex items-center justify-between gap-2">
        <Link to={`/databases/${dbId}`} className="flex items-center gap-2 truncate hover:underline">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300">
            <Database size={15} />
          </span>
          <span className="truncate font-semibold text-slate-100 text-xs">{data.name}</span>
        </Link>
        <StatusBadge status={data.status} />
      </div>
      <div className="mt-2.5 flex items-center justify-between rounded-lg bg-emerald-500/[0.06] px-2 py-1 font-mono text-[10px]">
        <span className="capitalize text-emerald-400">{data.engine}</span>
        <span className="text-emerald-300/80">Managed</span>
      </div>
    </div>
  );
}

function DomainNode(props: NodeProps) {
  const data = props.data as DomainData;
  return (
    <div className="rounded-xl border border-sky-500/30 bg-slate-900/90 px-3 py-2 shadow-lg shadow-black/40 backdrop-blur-md transition hover:border-sky-400">
      <Handle type="source" position={Position.Right} style={{ background: '#38bdf8' }} />
      <div className="flex items-center gap-2">
        <Globe size={13} className={data.ssl ? 'text-emerald-400' : 'text-sky-400'} />
        <span className="font-mono text-xs font-medium text-slate-200">{data.hostname}</span>
      </div>
    </div>
  );
}

function VolumeNode(props: NodeProps) {
  const data = props.data as VolumeData;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-slate-900/90 px-3 py-1.5 shadow-lg backdrop-blur-md">
      <Handle type="target" position={Position.Top} style={{ background: '#f59e0b' }} />
      <div className="flex items-center gap-1.5" title={data.name}>
        <HardDrive size={13} className="text-amber-400" />
        <span className="font-mono text-xs text-amber-200/90">{data.name.replace(/^(nd-(svc|db)-|-data$)/g, '')}</span>
      </div>
    </div>
  );
}

function NetworkNode(props: NodeProps) {
  const data = props.data as NetworkData;
  return (
    <div className="rounded-xl border border-sky-500/40 bg-slate-900/90 px-3 py-1.5 shadow-lg backdrop-blur-md">
      <Handle type="source" position={Position.Bottom} style={{ background: '#0ea5e9' }} />
      <div className="flex items-center gap-2">
        <Waypoints size={13} className="text-sky-400" />
        <span className="font-mono text-xs font-semibold text-slate-200">{data.name}</span>
        <span className="rounded bg-sky-500/20 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">×{data.containers}</span>
      </div>
    </div>
  );
}

function GatewayNode(props: NodeProps) {
  const data = props.data as GatewayData;
  return (
    <div className="w-44 rounded-2xl border-2 border-sky-500/40 bg-slate-900/95 p-3.5 shadow-xl shadow-black/50 backdrop-blur-md">
      <Handle type="target" position={Position.Left} style={{ background: '#0ea5e9' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#0ea5e9' }} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-sky-500/15 text-sky-300">
            <ShieldCheck size={16} />
          </span>
          <div>
            <p className="font-bold text-slate-100 text-xs">Traefik</p>
            <p className="text-[10px] text-slate-400">Gateway</p>
          </div>
        </div>
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
  // Focus mode: when a service is picked, only its slice of the graph renders
  // (its domains, attached databases, volumes and mesh links).
  const [focus, setFocus] = useState<number | null>(null);
  const onFocusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFocus(e.target.value ? Number(e.target.value) : null);
  };
  const resetFocus = () => setFocus(null);
  const retry = () => graph.refetch();

  const filtered = useMemo(() => {
    const g = graph.data;
    const svc = g?.services.find((s) => s.id === focus);
    if (focus == null || !g || !svc) return g; // no focus, or the service vanished
    const atts = g.attachments.filter((a) => a.serviceId === focus);
    const dbIds = new Set(atts.map((a) => a.databaseId));
    return {
      ...g,
      services: [svc],
      domains: g.domains.filter((d) => d.serviceId === focus),
      attachments: atts,
      databases: g.databases.filter((d) => dbIds.has(d.id)),
      volumes: g.volumes.filter(
        (v) =>
          v.owner &&
          ((v.owner.kind === 'service' && v.owner.refId === focus) ||
            (v.owner.kind === 'database' && dbIds.has(v.owner.refId))),
      ),
    };
  }, [graph.data, focus]);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const g = filtered;

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
    for (const [i, n] of (g?.networks ?? []).entries()) {
      nodes.push({ id: `net-${n.name}`, type: 'network', position: { x: NETWORK_X + i * 150, y: -120 }, data: { name: n.name, containers: n.containers.length } });
      for (const c of n.containers) {
        const target = services.find((s) => s.runtimeId === c);
        if (!target) continue; // gateway/agent containers aren't service nodes
        edges.push({ id: `e-net-${n.name}-${c}`, source: `net-${n.name}`, target: `service-${target.id}`, style: { stroke: '#0ea5e9', strokeDasharray: '2 4' } });
      }
    }

    return { nodes, edges };
  }, [filtered]);

  const [selectedNode, setSelectedNode] = useState<{ id: string; type?: string; data: any } | null>(null);

  return (
    <div className="relative space-y-4 nd-fade">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          icon={<Waypoints size={20} />}
          title="Infrastructure Topology"
          subtitle="Real-time interactive graph of your services, attached databases, networks, gateway and storage volumes."
        />
        <div className="flex items-center gap-2">
          <label htmlFor="topology-focus" className="text-xs text-slate-500">
            focus
          </label>
          <select
            id="topology-focus"
            aria-label="Focus service"
            value={focus ?? ''}
            onChange={onFocusChange}
            disabled={graph.isLoading}
            className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-[var(--nd-accent)]"
          >
            <option value="">all services</option>
            {(graph.data?.services ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {focus != null && (
            <button
              type="button"
              onClick={resetFocus}
              className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-400 transition hover:bg-white/[0.08] hover:text-slate-200"
            >
              reset
            </button>
          )}
        </div>
      </div>

      <div className="relative nd-fade h-[72vh] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40">
        {graph.isLoading ? (
          <div className="grid h-full place-items-center text-sm text-slate-500">Loading graph…</div>
        ) : graph.isError ? (
          <div className="grid h-full place-items-center">
            <ErrorCard title="Couldn't load the topology" error={graph.error} onRetry={retry} />
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
              onNodeClick={(_, node) => setSelectedNode(node)}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e293b" />
              <Controls className="!border-white/10 !bg-slate-900/80" showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        )}

        {/* Node Inspector Drawer */}
        {selectedNode && (
          <div className="absolute right-4 top-4 bottom-4 w-80 rounded-2xl border border-white/15 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-xl z-20 flex flex-col justify-between nd-fade">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                    {selectedNode.type || 'Node'}
                  </span>
                  <h3 className="text-sm font-semibold text-slate-100 truncate">
                    {selectedNode.data?.name || selectedNode.id}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedNode(null)}
                  className="rounded-lg p-1 text-slate-400 hover:text-slate-200 hover:bg-white/10 transition"
                  aria-label="Close Inspector"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-2 text-xs">
                {selectedNode.data?.status && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Status</span>
                    <StatusBadge status={selectedNode.data.status} />
                  </div>
                )}
                {selectedNode.data?.port && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Port</span>
                    <span className="font-mono text-slate-200">:{selectedNode.data.port}</span>
                  </div>
                )}
                {selectedNode.data?.engine && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Engine</span>
                    <span className="font-mono text-slate-200 uppercase">{selectedNode.data.engine}</span>
                  </div>
                )}
                {selectedNode.data?.routes != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Active Routes</span>
                    <span className="font-mono text-slate-200">{selectedNode.data.routes}</span>
                  </div>
                )}
                {selectedNode.data?.containers != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Attached Containers</span>
                    <span className="font-mono text-slate-200">{selectedNode.data.containers}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-white/10">
              {selectedNode.type === 'service' && selectedNode.data?.id && (
                <Link
                  to={`/services/${selectedNode.data.id}`}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/30"
                >
                  Open Service Details &rarr;
                </Link>
              )}
              {selectedNode.type === 'database' && selectedNode.data?.id && (
                <Link
                  to={`/databases/${selectedNode.data.id}`}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition shadow-lg shadow-emerald-600/30"
                >
                  Open Database Studio &rarr;
                </Link>
              )}
              {selectedNode.type === 'gateway' && (
                <Link
                  to="/domains"
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 transition shadow-lg shadow-sky-600/30"
                >
                  Manage Gateway Routes &rarr;
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

