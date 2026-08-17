import { describe, expect, it } from 'vitest';
import { ServiceRegistry } from '../../src/kernel/serviceRegistry.js';

describe('ServiceRegistry', () => {
  it('registers, checks, and retrieves services and typed drivers', () => {
    const registry = new ServiceRegistry();
    const mockCompute = { name: 'docker', pullImage: async () => {}, runContainer: async () => {}, stopContainer: async () => {}, removeContainer: async () => {}, inspectContainer: async () => ({ status: 'ok' }), getLogs: async () => [] };
    const mockProxy = { name: 'traefik', syncConfiguration: async () => {}, reload: async () => {}, getCertificateStatus: async () => [] };
    const mockStorage = { name: 's3', upload: async () => {}, download: async () => {}, delete: async () => {} };

    registry.register('custom.svc', { id: 1 });
    expect(registry.has('custom.svc')).toBe(true);
    expect(registry.get('custom.svc')).toEqual({ id: 1 });
    expect(registry.getOptional('custom.svc')).toEqual({ id: 1 });

    registry.registerCompute(mockCompute);
    registry.registerProxy(mockProxy);
    registry.registerStorage(mockStorage);

    expect(registry.getCompute('docker')).toBe(mockCompute);
    expect(registry.getCompute('missing')).toBeUndefined();
    expect(registry.getProxy('traefik')).toBe(mockProxy);
    expect(registry.getProxy('missing')).toBeUndefined();
    expect(registry.getStorage('s3')).toBe(mockStorage);
    expect(registry.getStorage('missing')).toBeUndefined();
  });

  it('throws on duplicate registrations or missing services', () => {
    const registry = new ServiceRegistry();
    registry.register('proxy', { name: 'traefik' });

    expect(() => registry.register('proxy', { name: 'traefik2' })).toThrow(
      'Service "proxy" is already registered',
    );

    expect(() => registry.get('nonexistent')).toThrow(
      'Service "nonexistent" is not registered in the kernel registry',
    );
    expect(registry.getOptional('nonexistent')).toBeUndefined();
  });

  it('unregisters services and clears the registry', () => {
    const registry = new ServiceRegistry();
    registry.register('s1', 1);
    registry.register('s2', 2);

    expect(registry.unregister('s1')).toBe(true);
    expect(registry.unregister('s1')).toBe(false);
    expect(registry.has('s1')).toBe(false);

    registry.clear();
    expect(registry.has('s2')).toBe(false);
  });
});
