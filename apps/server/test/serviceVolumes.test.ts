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
  });
});
