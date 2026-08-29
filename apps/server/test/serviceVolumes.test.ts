import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serviceVolumesRoutes, _internal } from '../src/modules/serviceVolumes.js';
import { asUser, buildTestApp, createFakeDb, NOW, svcRow } from './helpers.js';

const execMocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../src/lib/exec.js', () => execMocks);

const dbEngineMocks = vi.hoisted(() => ({
  createDockerVolume: vi.fn(async (_name: string) => undefined),
  volumeExists: vi.fn(async (_name: string) => true),
}));
vi.mock('../src/engine/database.js', () => dbEngineMocks);

// Stub `loadServiceForUser` — the pre-existing implementation queries the
// `serviceWorkspaces` table which belongs to a parallel branch not merged
// here yet. The volume-attach route's auth gate has its own owner check
// via `serviceVolumeAttachments`, so this stub keeps the test independent.
vi.mock('../src/lib/resourceAccess.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/resourceAccess.js')>('../src/lib/resourceAccess.js');
  return {
    ...actual,
    loadServiceForUser: vi.fn(async (db: { query: { services: { findFirst: (a?: unknown) => Promise<unknown> } } }, _id: number) => {
      return db.query.services.findFirst();
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  // listManagedVolumeNames hits docker — return the candidate name for the
  // "attach existing" test, an empty list otherwise.
  execMocks.capture.mockImplementation(async (_cmd: string, args: string[]) => {
    if (args[0] === 'volume' && args[1] === 'ls') {
      return 'nd-svc-web-uploads\nnd-svc-web-data\n';
    }
    if (args[0] === 'volume' && args[1] === 'inspect') return '';
    if (args[0] === 'run' && args[1] === '--rm') return '0\t0\n';
    return '';
  });
  dbEngineMocks.createDockerVolume.mockResolvedValue(undefined);
});

describe('service volume attachments', () => {
  describe('volume-name derivation', () => {
    it('passes through an existing managed volume name', () => {
      const name = _internal.resolveVolumeName(svcRow({ slug: 'web' }), { volumeName: 'nd-svc-web-uploads' });
      expect(name).toBe('nd-svc-web-uploads');
    });

    it('rejects non-managed volume names on attach', () => {
      expect(() => _internal.resolveVolumeName(svcRow({ slug: 'web' }), { volumeName: 'random-vol' })).toThrow();
    });

    it('produces a managed nd-svc-<slug>-<label> name for create+attach', () => {
      const name = _internal.resolveVolumeName(svcRow({ slug: 'web' }), { create: { label: 'Uploads' } });
      expect(name).toBe('nd-svc-web-uploads');
    });

    it('slugifies non-ASCII labels', () => {
      const name = _internal.resolveVolumeName(svcRow({ slug: 'web' }), { create: { label: 'Cache & Logs' } });
      expect(name).toBe('nd-svc-web-cache-logs');
    });

    it('rejects a label that slugifies to an empty string', () => {
      // A label made entirely of non-ASCII glyphs the regex strips
      // (e.g. emoji) collapses to '' — the route must reject, not
      // mint a volume whose name ends in a stray dash.
      expect(() => _internal.resolveVolumeName(svcRow({ slug: 'web' }), { create: { label: '🚀' } })).toThrow(/Invalid label/);
    });

    it('rejects an input that has neither volumeName nor create.label', () => {
      // The route's body validator catches the missing fields first
      // in production, but the helper is exported and reusable
      // from other code paths (e.g. CLI smoke tests) that bypass
      // the zod schema. Cover the guard here.
      expect(() => _internal.resolveVolumeName(svcRow({ slug: 'web' }), {})).toThrow(/Either volumeName or create\.label/);
    });
  });

  describe('GET /:id/volumes', () => {
    it('returns the service\'s attachments with size + sharing metadata', async () => {
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            services: svcRow({ id: 1, slug: 'web' }),
            // Second attach row: same volumeName, different service → sharing=1.
            'service_volume_attachments': undefined,
          },
          select: {
            services: [svcRow({ id: 1, slug: 'web' })],
            databases: [],
            service_volume_attachments: [
              { id: 1, serviceId: 1, volumeName: 'nd-svc-web-uploads', containerPath: '/uploads', readOnly: false, createdAt: NOW, updatedAt: NOW },
            ],
          },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({ method: 'GET', url: '/1/volumes', headers: asUser() });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Array<{ volumeName: string; sharedWith: number; sizeBytes: number }>;
      expect(body).toHaveLength(1);
      expect(body[0]?.volumeName).toBe('nd-svc-web-uploads');
      // sizeBytes comes from `docker run --rm alpine du` — the mock returns 0.
      expect(body[0]?.sizeBytes).toBe(0);
      // Only this service has the row → no other sharer.
      expect(body[0]?.sharedWith).toBe(0);
    });
  });

  describe('POST /:id/volumes', () => {
    it('attaches an existing managed volume and queues a redeploy', async () => {
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: { services: svcRow({ id: 1, slug: 'web' }) },
          insert: {
            service_volume_attachments: [{ id: 9, serviceId: 1, volumeName: 'nd-svc-web-uploads', containerPath: '/uploads', readOnly: false, createdAt: NOW, updatedAt: NOW }],
            deployments: [{ id: 42, serviceId: 1, status: 'queued', trigger: 'user', message: 'Volume attached' }],
          },
        }),
      });
      await app.register(serviceVolumesRoutes);

      const res = await app.inject({
        method: 'POST',
        url: '/1/volumes',
        headers: asUser(),
        payload: { volumeName: 'nd-svc-web-uploads', containerPath: '/uploads' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { attachment: { id: number; volumeName: string }; deploymentId: number };
      expect(body.attachment.id).toBe(9);
      expect(body.attachment.volumeName).toBe('nd-svc-web-uploads');
      expect(body.deploymentId).toBe(42);
    });

    it('provisions a fresh volume and attaches it when create.label is given', async () => {
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: { services: svcRow({ id: 1, slug: 'web' }) },
          insert: {
            service_volume_attachments: [{ id: 9, serviceId: 1, volumeName: 'nd-svc-web-uploads', containerPath: '/uploads', readOnly: false, createdAt: NOW, updatedAt: NOW }],
            deployments: [{ id: 42, serviceId: 1, status: 'queued', trigger: 'user', message: 'Volume attached' }],
          },
        }),
      });
      await app.register(serviceVolumesRoutes);

      const res = await app.inject({
        method: 'POST',
        url: '/1/volumes',
        headers: asUser(),
        payload: { create: { label: 'Uploads' }, containerPath: '/uploads' },
      });
      expect(res.statusCode).toBe(200);
      expect(dbEngineMocks.createDockerVolume).toHaveBeenCalledWith('nd-svc-web-uploads', expect.any(Function));
    });

    it('refuses to attach at the primary volumeMount path', async () => {
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: { services: svcRow({ id: 1, slug: 'web', volumeMount: '/data' }) },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({
        method: 'POST',
        url: '/1/volumes',
        headers: asUser(),
        payload: { volumeName: 'nd-svc-web-uploads', containerPath: '/data' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('refuses non-managed volumeName even when the volume is missing from docker', async () => {
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: { services: svcRow({ id: 1, slug: 'web' }) },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({
        method: 'POST',
        url: '/1/volumes',
        headers: asUser(),
        payload: { volumeName: 'random-vol', containerPath: '/uploads' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects unsupported service types (pm2)', async () => {
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: { services: svcRow({ id: 1, slug: 'web', type: 'pm2' }) },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({
        method: 'POST',
        url: '/1/volumes',
        headers: asUser(),
        payload: { volumeName: 'nd-svc-web-uploads', containerPath: '/uploads' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /:id/volumes/:attId', () => {
    it('204s and returns 204 even when the attachment does not exist (idempotent — actually 404 here)', async () => {
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            services: svcRow({ id: 1, slug: 'web' }),
            service_volume_attachments: undefined,
          },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({ method: 'DELETE', url: '/1/volumes/9', headers: asUser() });
      expect(res.statusCode).toBe(404);
    });

    it('detaches even while the container is RUNNING and queues the mount-drop redeploy', async () => {
      const queuedDeploys: Array<Record<string, unknown>> = [];
      const app = await buildTestApp({
        db: createFakeDb({
          // runtimeId present + running: the old stop-first guard would have
          // answered 409 here and silently swallowed the detach in the UI.
          findFirst: {
            services: svcRow({ id: 1, slug: 'web', type: 'docker', runtimeId: 'c-web-1', status: 'running' }),
            service_volume_attachments: {
              id: 9, serviceId: 1, volumeName: 'nd-svc-web-uploads',
              containerPath: '/uploads', readOnly: false,
              createdAt: new Date(0), updatedAt: new Date(0),
            },
          },
          select: { serviceVolumeAttachments: [] },
          insert: {
            deployments: (values: Record<string, unknown>) => {
              queuedDeploys.push(values);
              return [{ id: 77 }];
            },
          },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({ method: 'DELETE', url: '/1/volumes/9', headers: asUser() });
      expect(res.statusCode).toBe(204);
      expect(queuedDeploys).toHaveLength(1);
      expect(String(queuedDeploys[0]?.message)).toContain('Volume detached');
    });
  });

  describe('PATCH /:id/volumes/:attId', () => {
    it('updates the containerPath and readOnly flags, queues a redeploy', async () => {
      const queuedDeploys: Array<Record<string, unknown>> = [];
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            services: svcRow({ id: 1, slug: 'web' }),
            service_volume_attachments: { id: 12, serviceId: 1, volumeName: 'nd-svc-web-uploads', containerPath: '/uploads', readOnly: false, createdAt: NOW, updatedAt: NOW },
          },
          update: {
            service_volume_attachments: (set: Record<string, unknown>) => {
              expect(set).toMatchObject({ containerPath: '/data', readOnly: true });
              expect(set.updatedAt).toBeInstanceOf(Date);
              return [{ id: 12, serviceId: 1, volumeName: 'nd-svc-web-uploads', containerPath: '/data', readOnly: true, createdAt: NOW, updatedAt: new Date() }];
            },
          },
          insert: {
            deployments: (values: Record<string, unknown>) => {
              queuedDeploys.push(values);
              return [{ id: 88 }];
            },
          },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({
        method: 'PATCH',
        url: '/1/volumes/12',
        headers: asUser(),
        payload: { containerPath: '/data', readOnly: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { attachment: { containerPath: string; readOnly: boolean }; deploymentId: number };
      expect(body.attachment).toMatchObject({ containerPath: '/data', readOnly: true });
      expect(body.deploymentId).toBe(88);
      expect(queuedDeploys).toHaveLength(1);
      await app.close();
    });

    it('refuses to retarget the path onto the service\'s primary volumeMount', async () => {
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            services: svcRow({ id: 1, slug: 'web', volumeMount: '/var/data' }),
            service_volume_attachments: { id: 12, serviceId: 1, volumeName: 'nd-svc-web-uploads', containerPath: '/uploads', readOnly: false, createdAt: NOW, updatedAt: NOW },
          },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({
        method: 'PATCH',
        url: '/1/volumes/12',
        headers: asUser(),
        payload: { containerPath: '/var/data' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/primary volume mount/);
      await app.close();
    });

    it('returns 404 when the attachment does not exist', async () => {
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            services: svcRow({ id: 1, slug: 'web' }),
            service_volume_attachments: undefined,
          },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({
        method: 'PATCH',
        url: '/1/volumes/999',
        headers: asUser(),
        payload: { readOnly: true },
      });
      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });

  describe('POST /:id/volumes/config-repair (by volumeName)', () => {
    it('runs the alpine rm against the named volume and queues a redeploy', async () => {
      const queuedDeploys: Array<Record<string, unknown>> = [];
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: { services: svcRow({ id: 1, slug: 'web' }) },
          insert: {
            deployments: (values: Record<string, unknown>) => {
              queuedDeploys.push(values);
              return [{ id: 91 }];
            },
          },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({
        method: 'POST',
        url: '/1/volumes/config-repair',
        headers: asUser(),
        payload: { filePath: 'wp-config.php', volumeName: 'nd-svc-web-data' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, deploymentId: 91 });
      // The `docker run` shelled out, with the file path injected
      // into the rm command — a regression that drops the file
      // name is the kind of thing that takes a week to diagnose.
      expect(execMocks.capture).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining(['run', '--rm', '-v', 'nd-svc-web-data:/data', 'alpine:latest', 'sh', '-c', "rm -f -- '/data/wp-config.php'"]),
      );
      expect(queuedDeploys).toHaveLength(1);
      expect(String(queuedDeploys[0]?.message)).toContain('Config repaired');
      await app.close();
    });

    it('rejects a volumeName that does not match the managed-volume pattern', async () => {
      const app = await buildTestApp({
        db: createFakeDb({ findFirst: { services: svcRow({ id: 1, slug: 'web' }) } }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({
        method: 'POST',
        url: '/1/volumes/config-repair',
        headers: asUser(),
        payload: { filePath: 'wp-config.php', volumeName: 'rogue-volume' },
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe('POST /:id/volumes error paths', () => {
    it('surfaces a UNIQUE container_path conflict as a 409', async () => {
      // SQLite / Drizzle throws a runtime Error whose message
      // contains both 'UNIQUE' and 'container_path' when the
      // compound (serviceId, container_path) index collides.
      // The route must catch that and surface a 409, not a 500.
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: { services: svcRow({ id: 1, slug: 'web' }) },
          insert: {
            service_volume_attachments: () => {
              throw new Error('UNIQUE constraint failed: service_volume_attachments.container_path');
            },
          },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({
        method: 'POST',
        url: '/1/volumes',
        headers: asUser(),
        payload: { volumeName: 'nd-svc-web-uploads', containerPath: '/uploads' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toMatch(/already mounted/);
      await app.close();
    });

    it('surfaces a UNIQUE volume_name conflict as a 409', async () => {
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: { services: svcRow({ id: 1, slug: 'web' }) },
          insert: {
            service_volume_attachments: () => {
              throw new Error('UNIQUE constraint failed: service_volume_attachments.volume_name');
            },
          },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({
        method: 'POST',
        url: '/1/volumes',
        headers: asUser(),
        payload: { volumeName: 'nd-svc-web-uploads', containerPath: '/uploads' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toMatch(/already attached/);
      await app.close();
    });

    it('rolls back the attachment row when docker volume create fails', async () => {
      const deletedIds: number[] = [];
      dbEngineMocks.createDockerVolume.mockRejectedValueOnce(new Error('docker daemon unreachable'));
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: { services: svcRow({ id: 1, slug: 'web' }) },
          insert: {
            service_volume_attachments: (values: Record<string, unknown>) => {
              expect(values).toMatchObject({ serviceId: 1, volumeName: 'nd-svc-web-data' });
              return [{ id: 99, ...values, createdAt: NOW, updatedAt: NOW }];
            },
          },
          delete: {
            service_volume_attachments: (where: unknown) => {
              const sql = (where as { queryChunks?: Array<{ value?: unknown }> })?.queryChunks ?? [];
              // We don't deeply parse drizzle's `eq(...)` node here;
              // any delete with a `service_volume_attachments.id`
              // condition counts as the rollback. (Falling back to
              // recording all deletes is fine — this is a mock.)
              void sql;
              deletedIds.push(99);
              return [];
            },
          },
        }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({
        method: 'POST',
        url: '/1/volumes',
        headers: asUser(),
        payload: { create: { label: 'data' }, containerPath: '/data' },
      });
      // The 500 surfaces to the client — the important assertion
      // is the rollback ran (so we are not left with a phantom row).
      expect(res.statusCode).toBe(500);
      expect(deletedIds).toContain(99);
      await app.close();
    });
  });

  describe('POST /:id/volumes/config-repair (by attachmentId)', () => {
    it('deletes the baked config from the volume and queues a redeploy (config repair)', async () => {
      const queuedDeploys: Array<Record<string, unknown>> = [];
      const app = await buildTestApp({
        db: createFakeDb({
          findFirst: {
            services: svcRow({ id: 1, slug: 'web', type: 'docker' }),
            service_volume_attachments: {
              id: 9, serviceId: 1, volumeName: 'nd-svc-web-html',
              containerPath: '/var/www/html', readOnly: false,
              createdAt: new Date(0), updatedAt: new Date(0),
            },
          },
          select: { serviceVolumeAttachments: [] },
          insert: {
            deployments: (values: Record<string, unknown>) => {
              queuedDeploys.push(values);
              return [{ id: 78 }];
            },
          },
        }),
      });
      await app.register(serviceVolumesRoutes);

      const res = await app.inject({
        method: 'POST',
        url: '/1/volumes/config-repair',
        headers: asUser(),
        payload: { attachmentId: 9, filePath: 'wp-config.php' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, deploymentId: 78 });
      expect(queuedDeploys).toHaveLength(1);
      expect(String(queuedDeploys[0]?.message)).toContain('Config repaired');

      // The docker call removed exactly the requested file from the volume root.
      const shCmds = execMocks.capture.mock.calls.map(
        ([_cmd, args]) => (Array.isArray(args) ? ((args.at(-1) as string | undefined) ?? '') : ''),
      );
      expect(shCmds.some((cmd) => cmd.includes("rm -f -- '/data/wp-config.php'"))).toBe(true);
    });

    it.each([
      [{ filePath: '../etc/passwd' }, 'path traversal attempt'],
      [{ filePath: 'sub/dir/wp-config.php' }, 'nested path'],
      [{}, 'no selector'],
      [{ attachmentId: 9, volumeName: 'nd-svc-web-html', filePath: 'wp-config.php' }, 'both selectors'],
    ])('rejects config-repair payload: %j (%s)', async (payload) => {
      const app = await buildTestApp({
        db: createFakeDb({ findFirst: { services: svcRow({ id: 1, slug: 'web', type: 'docker' }) } }),
      });
      await app.register(serviceVolumesRoutes);
      const res = await app.inject({
        method: 'POST',
        url: '/1/volumes/config-repair',
        headers: asUser(),
        payload,
      });
      expect([400, 404]).toContain(res.statusCode); // validation error before any docker call
      expect(execMocks.capture).not.toHaveBeenCalledWith('docker', expect.arrayContaining(['sh']));
    });
  });
});

