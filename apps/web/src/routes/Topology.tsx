import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowUpRight,
  Boxes,
  Database,
  Globe,
  HardDrive,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import { api } from '../lib/api.js';
import type { TopologyGraph } from '@ninedeploy/sdk';
import { Button, ErrorCard, PageHeader, StatusBadge, cn } from '../components/ui.js';
import { formatBytes } from '../lib/format.js';

// Layout Column Offsets
const DOMAIN_X = 30;
const GATEWAY_X = 280;
const SERVICE_X = 560;
const DB_X = 1000;
const NETWORK_X = SERVICE_X;
const GAP = 150;
const NODE_H = 75;
const STACK_GAP = 54;

type ServiceData = {
  id: number;
  name: string;
  slug: string;
  status: string;
  type: string;
  image: string | null;
  port: number | null;
  runtimeId: string | null;
  cpuPct?: number;
  memMb?: number;
};

type DatabaseData = {
  id: number;
  name: string;
  status: string;
  engine: string;
  port?: number | null;
  cpuPct?: number;
  memMb?: number;
};

type DomainData = {
  hostname: string;
  ssl?: boolean;
  serviceId?: number;
};

type VolumeData = {
  name: string;
  sizeBytes?: number;
  ownerKind?: string;
  ownerName?: string;
  isProtected?: boolean;
};

type NetworkData = {
  name: string;
  containers: number;
};

type GatewayData = {
  running: boolean;
  activeRoutes: number;
};

// ── Custom Rich Node Components ───────────────────────────────────────────

function ServiceNode(props: NodeProps) {
  const data = props.data as ServiceData;
  const isRunning = data.status === 'running';

  return (
    <div className={cn(
      'w-64 rounded-2xl border bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-md transition-all group',
      isRunning
        ? 'border-indigo-500/50 hover:border-indigo-400 hover:shadow-indigo-500/20'
        : 'border-slate-700/60 hover:border-slate-600',
    )}>
      <Handle type="target" position={Position.Left} style={{ background: '#6366f1', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: '#10b981', width: 8, height: 8 }} />
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ background: '#f59e0b', width: 8, height: 8 }} />

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset',
            isRunning ? 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30' : 'bg-slate-800 text-slate-400 ring-white/5',
          )}>
            <Server size={17} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-bold text-slate-100 text-xs">{data.name}</span>
            </div>
            <p className="font-mono text-[10px] text-slate-400 truncate">
              {data.runtimeId || `nd-svc-${data.slug}`}
            </p>
          </div>
        </div>
        <StatusBadge status={data.status} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl bg-white/[0.03] p-1.5 font-mono text-[10px] ring-1 ring-inset ring-white/5">
        <div className="flex items-center justify-between px-1">
          <span className="text-slate-500 uppercase">{data.type}</span>
          <span className="text-slate-300">:{data.port ?? '—'}</span>
        </div>
        <div className="flex items-center justify-end gap-2 px-1 text-right">
          {data.cpuPct != null && (
            <span className="text-indigo-300 font-semibold">{data.cpuPct}%</span>
          )}
          {data.memMb != null && (
            <span className="text-sky-300 font-semibold">{data.memMb}M</span>
          )}
          {data.cpuPct == null && (
            <span className="text-slate-500">active</span>
          )}
        </div>
      </div>
    </div>
  );
}

function DatabaseNode(props: NodeProps) {
  const data = props.data as DatabaseData;
  const isRunning = data.status === 'running';

  const engineColors: Record<string, string> = {
    postgres: 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30 border-indigo-500/40',
    redis: 'bg-rose-500/15 text-rose-300 ring-rose-500/30 border-rose-500/40',
    mysql: 'bg-amber-500/15 text-amber-300 ring-amber-500/30 border-amber-500/40',
    mariadb: 'bg-amber-500/15 text-amber-300 ring-amber-500/30 border-amber-500/40',
    mongodb: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 border-emerald-500/40',
  };

  const badgeStyle = engineColors[data.engine.toLowerCase()] || 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 border-emerald-500/40';

  return (
    <div className={cn(
      'w-60 rounded-2xl border bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-md transition-all group',
      isRunning ? 'border-emerald-500/50 hover:border-emerald-400 hover:shadow-emerald-500/20' : 'border-slate-700/60 hover:border-slate-600',
    )}>
      <Handle type="target" position={Position.Left} style={{ background: '#10b981', width: 8, height: 8 }} />
      <Handle type="source" id="bottom" position={Position.Bottom} style={{ background: '#f59e0b', width: 8, height: 8 }} />

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset', badgeStyle)}>
            <Database size={17} />
          </span>
          <div className="min-w-0">
            <span className="truncate font-bold text-slate-100 text-xs block">{data.name}</span>
            <span className="font-mono text-[10px] text-emerald-400/90 capitalize">{data.engine}</span>
          </div>
        </div>
        <StatusBadge status={data.status} />
      </div>

      <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-500/[0.06] px-2.5 py-1.5 font-mono text-[10px] ring-1 ring-inset ring-emerald-500/15">
        <span className="text-emerald-300/80">Managed DB</span>
        <span className="text-emerald-200 font-semibold">{data.port ? `:${data.port}` : 'Internal Mesh'}</span>
      </div>
    </div>
  );
}

function DomainNode(props: NodeProps) {
  const data = props.data as DomainData;
  return (
    <div className="rounded-xl border border-sky-500/40 bg-slate-900/95 px-3 py-2 shadow-xl shadow-black/50 backdrop-blur-md transition hover:border-sky-300">
      <Handle type="source" position={Position.Right} style={{ background: '#38bdf8', width: 7, height: 7 }} />
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-sky-500/15 text-sky-300">
          <Globe size={13} />
        </span>
        <div className="min-w-0">
          <span className="font-mono text-xs font-semibold text-slate-200 block truncate">{data.hostname}</span>
          <span className="font-mono text-[9px] text-emerald-400 flex items-center gap-1">
            <Lock size={9} /> {data.ssl !== false ? 'TLS 1.3 / ACME' : 'HTTP'}
          </span>
        </div>
      </div>
    </div>
  );
}

function VolumeNode(props: NodeProps) {
  const data = props.data as VolumeData;
  return (
    <div className="rounded-xl border border-amber-500/40 bg-slate-900/95 px-3 py-2 shadow-lg backdrop-blur-md transition hover:border-amber-400">
      <Handle type="target" position={Position.Top} style={{ background: '#f59e0b', width: 7, height: 7 }} />
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-amber-500/15 text-amber-300">
          <HardDrive size={13} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-semibold text-amber-200/90 truncate max-w-[120px]">
              {data.name.replace(/^(nd-(svc|db)-|-data$)/g, '')}
            </span>
            {data.isProtected !== false && (
              <span className="text-[9px] text-emerald-400 font-mono" title="Protected">🛡️</span>
            )}
          </div>
          {data.sizeBytes != null && (
            <span className="font-mono text-[10px] text-slate-400">{formatBytes(data.sizeBytes)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function NetworkNode(props: NodeProps) {
  const data = props.data as NetworkData;
  return (
    <div className="rounded-xl border border-cyan-500/40 bg-slate-900/95 px-3 py-2 shadow-lg backdrop-blur-md">
      <Handle type="source" position={Position.Bottom} style={{ background: '#06b6d4', width: 7, height: 7 }} />
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-cyan-500/15 text-cyan-300">
          <Waypoints size={13} />
        </span>
        <div>
          <span className="font-mono text-xs font-bold text-slate-200 block">{data.name}</span>
          <span className="font-mono text-[10px] text-cyan-300">bridge · {data.containers} container(s)</span>
        </div>
      </div>
    </div>
  );
}

function GatewayNode(props: NodeProps) {
  const data = props.data as GatewayData;
  return (
    <div className="w-48 rounded-2xl border-2 border-sky-500/50 bg-slate-900/95 p-3.5 shadow-2xl shadow-sky-500/10 backdrop-blur-md">
      <Handle type="target" position={Position.Left} style={{ background: '#0ea5e9', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: '#0ea5e9', width: 8, height: 8 }} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/30">
            <ShieldCheck size={18} />
          </span>
          <div>
            <p className="font-bold text-slate-100 text-xs">Traefik v3</p>
            <p className="text-[10px] text-sky-300 font-mono">HTTP/3 · QUIC</p>
          </div>
        </div>
        <StatusBadge status={data.running ? 'running' : 'stopped'} />
      </div>
      <div className="mt-2.5 rounded-lg bg-sky-500/[0.08] px-2 py-1 font-mono text-[10px] text-sky-200 flex justify-between">
        <span>Active SSL Routes</span>
        <span className="font-bold">{data.activeRoutes}</span>
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

// ── Main Topology Page Component ──────────────────────────────────────────

export function Topology() {
  const graph = useQuery({ queryKey: ['topology'], queryFn: () => api.topology.get() });
  const volumesQuery = useQuery({ queryKey: ['volumes'], queryFn: () => api.volumes.list() });
  const liveStats = useQuery({
    queryKey: ['live-stats-snapshot'],
    queryFn: () => api.stats.snapshot(),
    refetchInterval: 4000,
  });

  const [focus, setFocus] = useState<number | null>(null);
  const [layerFilter, setLayerFilter] = useState<'all' | 'compute' | 'storage' | 'network'>('all');
  const [selectedNode, setSelectedNode] = useState<{ id: string; type?: string; data: any } | null>(null);

  const containerStatsMap = useMemo(() => {
    const map = new Map<string, { cpuPct: number; memMb: number }>();
    const containers = liveStats.data?.containers ?? [];
    for (const c of containers) {
      map.set(c.name, { cpuPct: c.cpuPct, memMb: c.memMb });
    }
    return map;
  }, [liveStats.data]);

  const volumeSizeMap = useMemo(() => {
    const map = new Map<string, number>();
    const vols = volumesQuery.data ?? [];
    for (const v of vols) {
      map.set(v.name, v.sizeBytes);
    }
    return map;
  }, [volumesQuery.data]);

  const filtered = useMemo(() => {
    const g = graph.data;
    const svc = g?.services.find((s) => s.id === focus);
    if (focus == null || !g || !svc) return g;
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
    const totalHeight = Math.max(y, databases.length * GAP, 300);

    // 1. Domains (Left column)
    if (layerFilter === 'all' || layerFilter === 'network') {
      (g?.domains ?? []).forEach((d) => {
        const sy = svcY.get(d.serviceId);
        if (sy == null) return;
        const idx = domainsBySvc.get(d.serviceId)!.findIndex((x) => x.id === d.id);
        nodes.push({
          id: `domain-${d.id}`,
          type: 'domain',
          position: { x: DOMAIN_X, y: sy + idx * STACK_GAP },
          data: { hostname: d.hostname, ssl: d.ssl, serviceId: d.serviceId },
        });
        edges.push({
          id: `e-dom-${d.id}`,
          source: `domain-${d.id}`,
          target: 'gateway',
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#38bdf8', strokeWidth: 1.5 },
        });
      });
    }

    // 2. Traefik Gateway
    if (layerFilter === 'all' || layerFilter === 'network') {
      if ((g?.domains ?? []).length > 0 || services.length > 0) {
        nodes.push({
          id: 'gateway',
          type: 'gateway',
          position: { x: GATEWAY_X, y: totalHeight / 2 - 40 },
          data: { running: g?.gateway?.running === true, activeRoutes: (g?.domains ?? []).length },
        });
        for (const [sid] of domainsBySvc) {
          if (!services.some((s) => s.id === sid)) continue;
          edges.push({
            id: `e-gw-${sid}`,
            source: 'gateway',
            target: `service-${sid}`,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#0ea5e9', strokeWidth: 2 },
          });
        }
      }
    }

    // 3. Services (Center column)
    if (layerFilter === 'all' || layerFilter === 'compute' || layerFilter === 'storage' || layerFilter === 'network') {
      services.forEach((s) => {
        const sy = svcY.get(s.id)!;
        const cStat = containerStatsMap.get(s.runtimeId ?? '') ||
                      containerStatsMap.get(`nd-svc-${s.slug}`) ||
                      containerStatsMap.get(`nd-app-${s.slug}`);

        nodes.push({
          id: `service-${s.id}`,
          type: 'service',
          position: { x: SERVICE_X, y: sy },
          data: {
            id: s.id,
            name: s.name,
            slug: s.slug,
            status: s.status,
            type: s.type,
            image: s.image ?? null,
            port: s.port ?? null,
            runtimeId: s.runtimeId,
            cpuPct: cStat?.cpuPct,
            memMb: cStat?.memMb,
          },
        });

        // Stacked Service Volumes
        if (layerFilter === 'all' || layerFilter === 'storage') {
          (volsByOwner.get(`service-${s.id}`) ?? []).forEach((v, i) => {
            const vid = `vol-${v.name}`;
            const sBytes = volumeSizeMap.get(v.name);
            nodes.push({
              id: vid,
              type: 'volume',
              position: { x: SERVICE_X + i * 150, y: sy + NODE_H + 30 },
              data: { name: v.name, sizeBytes: sBytes, ownerKind: 'service', ownerName: s.name },
            });
            edges.push({
              id: `e-${vid}`,
              source: `service-${s.id}`,
              sourceHandle: 'bottom',
              target: vid,
              type: 'smoothstep',
              style: { stroke: '#f59e0b', strokeDasharray: '4 4' },
            });
          });
        }
      });
    }

    // 4. Databases (Right column)
    if (layerFilter === 'all' || layerFilter === 'compute' || layerFilter === 'storage') {
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

        const cStat = containerStatsMap.get(`nd-db-${d.name}`) || containerStatsMap.get(d.name);
        const defaultPort = d.engine === 'postgres' ? 5432 : d.engine === 'redis' ? 6379 : d.engine === 'mysql' || d.engine === 'mariadb' ? 3306 : d.engine === 'mongodb' ? 27017 : null;

        nodes.push({
          id: `database-${d.id}`,
          type: 'database',
          position: { x: DB_X, y: dy },
          data: {
            id: d.id,
            name: d.name,
            status: d.status,
            engine: d.engine,
            port: defaultPort,
            cpuPct: cStat?.cpuPct,
            memMb: cStat?.memMb,
          },
        });
        dbY = dy + Math.max(GAP, NODE_H + 30 + volCount * (STACK_GAP - 6));

        // Stacked Database Volumes
        if (layerFilter === 'all' || layerFilter === 'storage') {
          (volsByOwner.get(`database-${d.id}`) ?? []).forEach((v, i) => {
            const vid = `vol-${v.name}`;
            const sBytes = volumeSizeMap.get(v.name);
            nodes.push({
              id: vid,
              type: 'volume',
              position: { x: DB_X + i * 150, y: dy + NODE_H + 30 },
              data: { name: v.name, sizeBytes: sBytes, ownerKind: 'database', ownerName: d.name },
            });
            edges.push({
              id: `e-${vid}`,
              source: `database-${d.id}`,
              sourceHandle: 'bottom',
              target: vid,
              type: 'smoothstep',
              style: { stroke: '#f59e0b', strokeDasharray: '4 4' },
            });
          });
        }
      });
    }

    // 5. Attachments Edges: Service → Database
    if (layerFilter === 'all' || layerFilter === 'compute') {
      (g?.attachments ?? []).forEach((a) => {
        edges.push({
          id: `e-att-${a.id}`,
          source: `service-${a.serviceId}`,
          target: `database-${a.databaseId}`,
          label: a.envAlias || 'ATTACHED_DB',
          labelStyle: { fill: '#34d399', fontSize: 10, fontFamily: 'monospace', fontWeight: 600 },
          labelBgStyle: { fill: '#064e3b', fillOpacity: 0.9, rx: 4, ry: 4 },
          style: { stroke: '#10b981', strokeWidth: 2 },
          type: 'smoothstep',
          animated: true,
        });
      });
    }

    // 6. Networks above Service Column
    if (layerFilter === 'all' || layerFilter === 'network') {
      for (const [i, n] of (g?.networks ?? []).entries()) {
        nodes.push({
          id: `net-${n.name}`,
          type: 'network',
          position: { x: NETWORK_X + i * 170, y: -110 },
          data: { name: n.name, containers: n.containers.length },
        });
        for (const c of n.containers) {
          const target = services.find((s) => s.runtimeId === c || `nd-svc-${s.slug}` === c);
          if (!target) continue;
          edges.push({
            id: `e-net-${n.name}-${c}`,
            source: `net-${n.name}`,
            target: `service-${target.id}`,
            type: 'smoothstep',
            style: { stroke: '#06b6d4', strokeDasharray: '3 3' },
          });
        }
      }
    }

    return { nodes, edges };
  }, [filtered, containerStatsMap, volumeSizeMap, layerFilter]);

  return (
    <div className="relative space-y-4 nd-fade">
      {/* Top Header & Interactive Filter Bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <PageHeader
          icon={<Waypoints size={20} className="text-indigo-400" />}
          title="Infrastructure Topology & Flow"
          subtitle="Real-time interactive blueprint of routed domains, Traefik proxy, services, databases, persistent volumes and network bridges."
        />

        <div className="flex flex-wrap items-center gap-2">
          {/* Layer Filter Pills */}
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 text-xs">
            <button
              type="button"
              onClick={() => setLayerFilter('all')}
              className={cn(
                'rounded-lg px-2.5 py-1 transition font-medium',
                layerFilter === 'all' ? 'bg-indigo-500/20 text-indigo-300 font-semibold shadow' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              All Layers
            </button>
            <button
              type="button"
              onClick={() => setLayerFilter('compute')}
              className={cn(
                'rounded-lg px-2.5 py-1 transition font-medium',
                layerFilter === 'compute' ? 'bg-indigo-500/20 text-indigo-300 font-semibold shadow' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              Compute & DBs
            </button>
            <button
              type="button"
              onClick={() => setLayerFilter('storage')}
              className={cn(
                'rounded-lg px-2.5 py-1 transition font-medium',
                layerFilter === 'storage' ? 'bg-amber-500/20 text-amber-300 font-semibold shadow' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              Storage
            </button>
            <button
              type="button"
              onClick={() => setLayerFilter('network')}
              className={cn(
                'rounded-lg px-2.5 py-1 transition font-medium',
                layerFilter === 'network' ? 'bg-sky-500/20 text-sky-300 font-semibold shadow' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              Network
            </button>
          </div>

          {/* Service Focus Dropdown */}
          <div className="flex items-center gap-1.5">
            <select
              id="topology-focus"
              aria-label="Focus service"
              value={focus ?? ''}
              onChange={(e) => setFocus(e.target.value ? Number(e.target.value) : null)}
              disabled={graph.isLoading}
              className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">All Services Focus</option>
              {(graph.data?.services ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {focus != null && (
              <Button size="sm" variant="secondary" onClick={() => setFocus(null)} className="text-xs">
                Reset
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => graph.refetch()}
              disabled={graph.isFetching}
              title="Refresh topology graph"
            >
              <RefreshCw size={13} className={graph.isFetching ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>
      </div>

      {/* Main React Flow Graph Canvas */}
      <div className="relative nd-fade h-[74vh] overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60 shadow-2xl backdrop-blur-xl">
        {graph.isLoading ? (
          <div className="grid h-full place-items-center text-sm text-slate-400 font-mono">
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="animate-spin text-indigo-400" />
              <span>Building topology mesh…</span>
            </div>
          </div>
        ) : graph.isError ? (
          <div className="grid h-full place-items-center p-6">
            <ErrorCard title="Couldn't load infrastructure topology" error={graph.error} onRetry={() => graph.refetch()} />
          </div>
        ) : nodes.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-slate-400 font-mono">
            <div className="text-center space-y-2">
              <Boxes size={32} className="mx-auto text-slate-600" />
              <p className="font-semibold text-slate-300">No active topology components</p>
              <p className="text-xs text-slate-500">Deploy a service or provision a database to see live routing and data links.</p>
            </div>
          </div>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ style: { stroke: '#475569' } }}
              onNodeClick={(_, node) => setSelectedNode(node)}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#334155" />
              <Controls className="!border-white/10 !bg-slate-900/90 !rounded-xl overflow-hidden shadow-xl" showInteractive={false} />
              <MiniMap
                nodeColor={(n) => {
                  if (n.type === 'service') return '#6366f1';
                  if (n.type === 'database') return '#10b981';
                  if (n.type === 'gateway') return '#0ea5e9';
                  if (n.type === 'volume') return '#f59e0b';
                  if (n.type === 'domain') return '#38bdf8';
                  return '#06b6d4';
                }}
                className="!bg-slate-950/80 !border-white/10 !rounded-2xl !overflow-hidden !shadow-2xl hidden md:block"
                maskColor="rgba(15, 23, 42, 0.75)"
              />
            </ReactFlow>
          </ReactFlowProvider>
        )}

        {/* Node Inspector Drawer */}
        {selectedNode && (
          <div className="absolute right-4 top-4 bottom-4 w-84 rounded-2xl border border-white/15 bg-slate-950/95 p-5 shadow-2xl backdrop-blur-2xl z-20 flex flex-col justify-between nd-fade">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="rounded-lg bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300 ring-1 ring-inset ring-indigo-500/30">
                    {selectedNode.type || 'Node'}
                  </span>
                  <h3 className="text-sm font-semibold text-slate-100 truncate">
                    {selectedNode.data?.name || selectedNode.data?.hostname || selectedNode.id}
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

              <div className="space-y-2.5 text-xs">
                {selectedNode.data?.status && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Runtime Status</span>
                    <StatusBadge status={selectedNode.data.status} />
                  </div>
                )}
                {selectedNode.data?.port && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Internal Port</span>
                    <span className="font-mono text-slate-200">:{selectedNode.data.port}</span>
                  </div>
                )}
                {selectedNode.data?.engine && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Database Engine</span>
                    <span className="font-mono text-emerald-300 uppercase font-semibold">{selectedNode.data.engine}</span>
                  </div>
                )}
                {selectedNode.data?.cpuPct != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Live CPU Usage</span>
                    <span className="font-mono text-indigo-300 font-bold">{selectedNode.data.cpuPct}%</span>
                  </div>
                )}
                {selectedNode.data?.memMb != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Live Memory (RAM)</span>
                    <span className="font-mono text-sky-300 font-bold">{selectedNode.data.memMb} MB</span>
                  </div>
                )}
                {selectedNode.data?.sizeBytes != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Volume Storage</span>
                    <span className="font-mono text-amber-300 font-bold">{formatBytes(selectedNode.data.sizeBytes)}</span>
                  </div>
                )}
                {selectedNode.data?.activeRoutes != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Active Proxy Routes</span>
                    <span className="font-mono text-sky-200">{selectedNode.data.activeRoutes} routes</span>
                  </div>
                )}
                {selectedNode.data?.containers != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Attached Containers</span>
                    <span className="font-mono text-cyan-200">{selectedNode.data.containers} container(s)</span>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 space-y-2">
              {selectedNode.type === 'service' && selectedNode.data?.id && (
                <Link
                  to={`/services/${selectedNode.data.id}`}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition shadow-lg shadow-indigo-600/30"
                >
                  <span>Open Service Workspace</span>
                  <ArrowUpRight size={13} />
                </Link>
              )}
              {selectedNode.type === 'database' && selectedNode.data?.id && (
                <Link
                  to={`/databases/${selectedNode.data.id}`}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition shadow-lg shadow-emerald-600/30"
                >
                  <span>Open Database Studio</span>
                  <ArrowUpRight size={13} />
                </Link>
              )}
              {selectedNode.type === 'gateway' && (
                <Link
                  to="/traefik"
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 transition shadow-lg shadow-sky-600/30"
                >
                  <span>Open Traefik Control Center</span>
                  <ArrowUpRight size={13} />
                </Link>
              )}
              {selectedNode.type === 'volume' && (
                <Link
                  to="/volumes"
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 transition shadow-lg shadow-amber-600/30"
                >
                  <span>Manage All Volumes</span>
                  <ArrowUpRight size={13} />
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
