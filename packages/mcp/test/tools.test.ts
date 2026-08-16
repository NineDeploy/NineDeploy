import { describe, expect, it, vi } from 'vitest';
import { TOOLS } from '../src/tools.js';
import type { NineDeployClient } from '@ninedeploy/sdk';

/** A client where every method is a spy returning a marker. */
function fakeClient(): NineDeployClient {
  const list = vi.fn(async () => 'LIST');
  return {
    services: { list, get: vi.fn(async () => 'GET'), logs: vi.fn(async () => 'LOGS'), restart: vi.fn(async () => 'RESTART') },
    deploys: { list: vi.fn(async () => 'DEPLOYS'), trigger: vi.fn(async () => 'TRIGGER'), rollback: vi.fn(async () => 'ROLLBACK') },
    domains: { all: vi.fn(async () => 'DOMAINS') },
    databases: { list: vi.fn(async () => 'DBS') },
    projects: { list: vi.fn(async () => 'PROJECTS') },
    alerts: { list: vi.fn(async () => 'ALERTS') },
    activity: { list: vi.fn(async () => 'ACTIVITY') },
    stats: { snapshot: vi.fn(async () => 'STATS') },
    topology: { get: vi.fn(async () => 'TOPO') },
    health: vi.fn(async () => 'HEALTH'),
  } as unknown as NineDeployClient;
}

const byName = (name: string) => {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
};

describe('MCP tools', () => {
  it('exposes 15 unique tools with descriptions', () => {
    expect(TOOLS).toHaveLength(15);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(15);
    for (const t of TOOLS) expect(t.description.length).toBeGreaterThan(10);
  });

  it('list_services scopes by project when given', async () => {
    const c = fakeClient();
    await byName('list_services').handler(c, {});
    await byName('list_services').handler(c, { projectId: 3 });
    expect(c.services.list).toHaveBeenNthCalledWith(1, '');
    expect(c.services.list).toHaveBeenNthCalledWith(2, '?projectId=3');
  });

  it('id-based tools forward the parsed service id', async () => {
    const c = fakeClient();
    expect(await byName('get_service').handler(c, { serviceId: 7 })).toBe('GET');
    expect(c.services.get).toHaveBeenCalledWith(7);
    expect(await byName('service_logs').handler(c, { serviceId: 7 })).toBe('LOGS');
    expect(await byName('list_deploys').handler(c, { serviceId: 7 })).toBe('DEPLOYS');
    expect(await byName('deploy_service').handler(c, { serviceId: 7 })).toBe('TRIGGER');
    expect(c.deploys.trigger).toHaveBeenCalledWith(7);
    expect(await byName('restart_service').handler(c, { serviceId: 7 })).toBe('RESTART');
  });

  it('rollback passes both ids', async () => {
    const c = fakeClient();
    await byName('rollback_deploy').handler(c, { serviceId: 4, deploymentId: 9 });
    expect(c.deploys.rollback).toHaveBeenCalledWith(4, 9);
  });

  it('activity_log forwards the optional entity filter', async () => {
    const c = fakeClient();
    await byName('activity_log').handler(c, {});
    await byName('activity_log').handler(c, { entity: 'my-api' });
    expect(c.activity.list).toHaveBeenNthCalledWith(1, { entity: undefined });
    expect(c.activity.list).toHaveBeenNthCalledWith(2, { entity: 'my-api' });
  });

  it('parameterless tools call their SDK counterpart', async () => {
    const c = fakeClient();
    expect(await byName('list_domains').handler(c, {})).toBe('DOMAINS');
    expect(await byName('list_databases').handler(c, {})).toBe('DBS');
    expect(await byName('list_projects').handler(c, {})).toBe('PROJECTS');
    expect(await byName('list_alerts').handler(c, {})).toBe('ALERTS');
    expect(await byName('system_stats').handler(c, {})).toBe('STATS');
    expect(await byName('topology').handler(c, {})).toBe('TOPO');
    expect(await byName('health').handler(c, {})).toBe('HEALTH');
  });

  it('input schemas reject malformed ids', () => {
    expect(byName('get_service').input.safeParse({ serviceId: 0 }).success).toBe(false);
    expect(byName('get_service').input.safeParse({}).success).toBe(false);
    expect(byName('get_service').input.safeParse({ serviceId: 5 }).success).toBe(true);
    expect(byName('rollback_deploy').input.safeParse({ serviceId: 5 }).success).toBe(false);
    expect(byName('list_services').input.safeParse({ projectId: 'x' }).success).toBe(false);
  });
});
