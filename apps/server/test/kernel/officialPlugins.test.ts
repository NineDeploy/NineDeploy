import { describe, expect, it, vi } from 'vitest';
import { NineDeployKernel } from '../../src/kernel/kernel.js';
import { CloudflareTunnelsPlugin } from '../../src/kernel/plugins/cloudflareTunnels.js';
import { NotificationsDispatcherPlugin } from '../../src/kernel/plugins/notifications.js';
import { TelemetryStreamerPlugin } from '../../src/kernel/plugins/telemetry.js';

describe('Official Kernel Plugins', () => {
  const mockDb = {
    query: {
      configEntries: { findMany: vi.fn().mockResolvedValue([]) },
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue([]) }) }),
  };

  const mockConfig = {
    port: 3000,
    host: '0.0.0.0',
    jwtSecret: 'test-secret-at-least-32-chars-long-12345',
    dataDir: '/tmp/ninedeploy-test',
  };

  describe('NotificationsDispatcherPlugin', () => {
    it('initializes and handles domain events for notifications', async () => {
      const kernel = new NineDeployKernel(mockDb as never, mockConfig);
      const plugin = new NotificationsDispatcherPlugin();

      await kernel.registerPlugin(plugin);

      const notifications: unknown[] = [];
      kernel.events.on('notification.queued', (payload) => {
        notifications.push(payload);
      });

      // 1. Deployment status changed (failed)
      kernel.events.emit('deployment.status_changed', { deploymentId: 10, serviceName: 'api', status: 'failed' });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toEqual({
        title: 'Deployment failed',
        body: 'Service api deployment #10 changed to failed',
        level: 'error',
      });

      // 2. Deployment status changed (success)
      kernel.events.emit('deployment.status_changed', { deploymentId: 11, serviceName: 'web', status: 'ready' });
      expect(notifications).toHaveLength(2);
      expect(notifications[1]).toEqual({
        title: 'Deployment ready',
        body: 'Service web deployment #11 changed to ready',
        level: 'info',
      });

      // 3. Deployment status without name/id
      kernel.events.emit('deployment.status_changed', {});
      expect(notifications).toHaveLength(3);
      expect(notifications[2]).toEqual({
        title: 'Deployment Updated',
        body: 'Service Unknown deployment #0 changed to undefined',
        level: 'info',
      });

      // 4. Service health changed (unhealthy)
      kernel.events.emit('service.health_changed', { serviceId: 5, status: 'unhealthy' });
      expect(notifications).toHaveLength(4);
      expect(notifications[3]).toEqual({
        title: 'Service Health Alert',
        body: 'Service #5 transitioned to unhealthy',
        level: 'error',
      });

      // 5. Service health changed (dead status and empty serviceId)
      kernel.events.emit('service.health_changed', { status: 'dead' });
      expect(notifications).toHaveLength(5);
      expect(notifications[4]).toEqual({
        title: 'Service Health Alert',
        body: 'Service #0 transitioned to dead',
        level: 'error',
      });

      // 6. Service health changed (healthy - should not notify)
      kernel.events.emit('service.health_changed', { serviceId: 5, status: 'healthy' });
      expect(notifications).toHaveLength(5);

      // 7. Backup completed
      kernel.events.emit('backup.completed', { databaseId: 2, sizeBytes: 102400 });
      expect(notifications).toHaveLength(6);
      expect(notifications[5]).toEqual({
        title: 'Database Backup Completed',
        body: 'Database #2 backup succeeded (102400 bytes)',
        level: 'info',
      });

      // 8. Backup completed with empty payload
      kernel.events.emit('backup.completed', {});
      expect(notifications).toHaveLength(7);
      expect(notifications[6]).toEqual({
        title: 'Database Backup Completed',
        body: 'Database #0 backup succeeded (0 bytes)',
        level: 'info',
      });

      // Destroy
      plugin.destroy();
    });
  });

  describe('CloudflareTunnelsPlugin', () => {
    it('registers menu item and executes deploy.after hook', async () => {
      const kernel = new NineDeployKernel(mockDb as never, mockConfig);
      const plugin = new CloudflareTunnelsPlugin();

      await kernel.registerPlugin(plugin);

      // Verify menu item registered
      const items = kernel.menuRegistry.getItemsForSlot('sidebar:secondary', 'admin');
      const tunnelItem = items.find((i) => i.id === 'cf-tunnels-nav');
      expect(tunnelItem).toBeDefined();
      expect(tunnelItem?.route).toBe('/tunnels');

      // Verify hook execution
      const routeEvents: unknown[] = [];
      kernel.events.on('tunnel.route_evaluated', (payload) => {
        routeEvents.push(payload);
      });

      const result = await kernel.hooks.call('deploy.after', { serviceId: 100, domain: 'api.example.com' });
      expect(result).toEqual({ serviceId: 100, domain: 'api.example.com' });
      expect(routeEvents).toHaveLength(1);
      expect(routeEvents[0]).toEqual({ serviceId: 100, domain: 'api.example.com' });

      plugin.destroy();
    });
  });

  describe('TelemetryStreamerPlugin', () => {
    it('listens on wildcard events and emits telemetry records', async () => {
      const kernel = new NineDeployKernel(mockDb as never, mockConfig);
      const plugin = new TelemetryStreamerPlugin();

      await kernel.registerPlugin(plugin);

      const telemetry: unknown[] = [];
      kernel.events.on('telemetry.recorded', (payload) => {
        telemetry.push(payload);
      });

      kernel.events.emit('custom.system_event', { key: 'value' });

      expect(telemetry).toHaveLength(1);
      const record = telemetry[0] as { sourceEvent: string; data: { key: string }; timestamp: string };
      expect(record.sourceEvent).toBe('custom.system_event');
      expect(record.data).toEqual({ key: 'value' });
      expect(record.timestamp).toBeDefined();

      // Emit telemetry.recorded directly - should not re-record (recursion guard)
      kernel.events.emit('telemetry.recorded', { test: true });
      expect(telemetry).toHaveLength(2); // The direct listener catches it, but no new telemetry event is spawned

      plugin.destroy();
    });
  });
});
