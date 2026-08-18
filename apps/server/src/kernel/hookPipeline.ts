import type { HookDefinitions, IHookPipeline, KernelContext } from './types.js';

interface HookHandlerEntry {
  id?: string;
  priority: number;
  timeoutMs: number;
  handler: (payload: any, ctx: KernelContext) => Promise<any | undefined>;
}

export class HookPipeline implements IHookPipeline {
  private readonly hooks = new Map<string, HookHandlerEntry[]>();
  private contextGetter: () => KernelContext;

  constructor(contextGetter: () => KernelContext) {
    this.contextGetter = contextGetter;
  }

  tap<K extends keyof HookDefinitions>(
    hook: K,
    handler: (payload: HookDefinitions[K], ctx: KernelContext) => Promise<undefined | HookDefinitions[K]>,
    opts?: { priority?: number; id?: string; timeoutMs?: number },
  ): () => void {
    const hookName = hook as string;
    const entry: HookHandlerEntry = {
      id: opts?.id,
      priority: opts?.priority ?? 100,
      timeoutMs: opts?.timeoutMs ?? 5000,
      handler,
    };

    let list = this.hooks.get(hookName);
    if (!list) {
      list = [];
      this.hooks.set(hookName, list);
    }

    list.push(entry);
    list.sort((a, b) => b.priority - a.priority); // Higher priority runs first

    return () => {
      const current = this.hooks.get(hookName);
      if (current) {
        const index = current.indexOf(entry);
        if (index !== -1) {
          current.splice(index, 1);
          if (current.length === 0) {
            this.hooks.delete(hookName);
          }
        }
      }
    };
  }

  async call<K extends keyof HookDefinitions>(hook: K, initialPayload: HookDefinitions[K]): Promise<HookDefinitions[K]> {
    const hookName = hook as string;
    const list = this.hooks.get(hookName);
    if (!list || list.length === 0) {
      return initialPayload;
    }

    let currentPayload = initialPayload;
    const ctx = this.contextGetter();

    for (const entry of Array.from(list)) {
      try {
        let timer: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Hook "${hookName}" handler ${entry.id ? `(${entry.id}) ` : ''}timed out after ${entry.timeoutMs}ms`));
          }, entry.timeoutMs);
        });

        try {
          const result = await Promise.race([
            entry.handler(currentPayload, ctx),
            timeoutPromise,
          ]);

          if (result && typeof result === 'object') {
            currentPayload = result;
          }
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        console.error(`[HookPipeline] Error executing hook "${hookName}":`, err);
        // If the payload has an abort/allowOrAbort mechanism, handler error can be reflected or logged
      }
    }

    return currentPayload;
  }

  hasListeners(hook: string): boolean {
    const list = this.hooks.get(hook);
    return !!list && list.length > 0;
  }

  clear(): void {
    this.hooks.clear();
  }
}
