import { describe, expect, it } from 'vitest';
import { assertCanManageService, loadServiceForUser } from '../../src/lib/serviceAccess.js';

describe('serviceAccess', () => {
  describe('assertCanManageService', () => {
    it('allows admins to manage any service', () => {
      expect(() =>
        assertCanManageService({ ownerUserId: 99 }, { id: 1, role: 'admin' }),
      ).not.toThrow();
    });

    it('allows owners to manage their own service', () => {
      expect(() =>
        assertCanManageService({ ownerUserId: 5 }, { id: 5, role: 'member' }),
      ).not.toThrow();
    });

    it('throws forbidden when member does not own the service', () => {
      expect(() =>
        assertCanManageService({ ownerUserId: 10 }, { id: 5, role: 'member' }),
      ).toThrow('You do not have access to this service');
    });

    it('throws forbidden when service owner is null for non-admin', () => {
      expect(() =>
        assertCanManageService({ ownerUserId: null as never }, { id: 5, role: 'member' }),
      ).toThrow('You do not have access to this service');
    });
  });

  describe('loadServiceForUser', () => {
    it('loads service for admin when it exists', async () => {
      const db = {
        query: {
          services: {
            findFirst: async () => ({ id: 1, name: 'web', ownerUserId: 2 }),
          },
        },
      };
      const svc = await loadServiceForUser(db as never, 1, { id: 99, role: 'admin' });
      expect(svc).toEqual({ id: 1, name: 'web', ownerUserId: 2 });
    });

    it('throws notFound for admin when service does not exist', async () => {
      const db = {
        query: {
          services: {
            findFirst: async () => null,
          },
        },
      };
      await expect(
        loadServiceForUser(db as never, 999, { id: 1, role: 'admin' }),
      ).rejects.toThrow('Service not found');
    });

    it('loads service for member when member owns it', async () => {
      const db = {
        query: {
          services: {
            findFirst: async () => ({ id: 2, name: 'api', ownerUserId: 5 }),
          },
        },
      };
      const svc = await loadServiceForUser(db as never, 2, { id: 5, role: 'member' });
      expect(svc).toEqual({ id: 2, name: 'api', ownerUserId: 5 });
    });

    it('throws notFound for member when service is owned by someone else', async () => {
      const db = {
        query: {
          services: {
            findFirst: async () => ({ id: 2, name: 'api', ownerUserId: 10 }),
          },
        },
      };
      await expect(
        loadServiceForUser(db as never, 2, { id: 5, role: 'member' }),
      ).rejects.toThrow('Service not found');
    });

    it('throws notFound for member when service does not exist', async () => {
      const db = {
        query: {
          services: {
            findFirst: async () => null,
          },
        },
      };
      await expect(
        loadServiceForUser(db as never, 999, { id: 5, role: 'member' }),
      ).rejects.toThrow('Service not found');
    });
  });
});
