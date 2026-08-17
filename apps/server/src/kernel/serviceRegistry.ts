import type { IServiceRegistry } from './types.js';

export class ServiceRegistry implements IServiceRegistry {
  private readonly services = new Map<string, unknown>();

  register<T>(name: string, service: T): void {
    if (this.services.has(name)) {
      throw new Error(`Service "${name}" is already registered`);
    }
    this.services.set(name, service);
  }

  get<T>(name: string): T {
    const service = this.services.get(name);
    if (service === undefined) {
      throw new Error(`Service "${name}" is not registered in the kernel registry`);
    }
    return service as T;
  }

  getOptional<T>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  unregister(name: string): boolean {
    return this.services.delete(name);
  }

  clear(): void {
    this.services.clear();
  }

  registerCompute(driver: import('./types.js').IComputeDriver): void {
    this.register(`compute:${driver.name}`, driver);
  }

  getCompute(name: string): import('./types.js').IComputeDriver | undefined {
    return this.getOptional(`compute:${name}`);
  }

  registerProxy(driver: import('./types.js').IProxyDriver): void {
    this.register(`proxy:${driver.name}`, driver);
  }

  getProxy(name: string): import('./types.js').IProxyDriver | undefined {
    return this.getOptional(`proxy:${name}`);
  }

  registerStorage(driver: import('./types.js').IStorageDriver): void {
    this.register(`storage:${driver.name}`, driver);
  }

  getStorage(name: string): import('./types.js').IStorageDriver | undefined {
    return this.getOptional(`storage:${name}`);
  }
}
