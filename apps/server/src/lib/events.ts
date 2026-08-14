import { EventEmitter } from 'node:events';

export interface AppEvent {
  id: number;
  action: string;
  entity: string | null;
  ts: string;
}

/**
 * Global event bus for real-time event streaming. The audit() helper publishes
 * here, and the /v1/events WebSocket subscribes to push live updates to the UI.
 */
class EventBus extends EventEmitter {
  // Timestamp-based so ids stay strictly increasing ACROSS restarts — clients
  // deduping by id would otherwise drop (or misorder) post-restart events when
  // the counter reset to 1.
  private seq = Date.now();
  private recent: AppEvent[] = [];
  private readonly MAX_RECENT = 100;

  constructor() {
    super();
    // Many concurrent dashboard/event-drawer sockets are normal; the default
    // ceiling of 10 would flood the logs with MaxListenersExceededWarning.
    this.setMaxListeners(0); // 0 = unlimited
  }

  publish(action: string, entity?: string | null): void {
    const event: AppEvent = { id: ++this.seq, action, entity: entity ?? null, ts: new Date().toISOString() };
    this.recent.push(event);
    if (this.recent.length > this.MAX_RECENT) this.recent = this.recent.slice(-this.MAX_RECENT);
    this.emit('event', event);
  }

  backlog(): AppEvent[] {
    return [...this.recent];
  }

  subscribe(cb: (event: AppEvent) => void): () => void {
    this.on('event', cb);
    return () => this.off('event', cb);
  }
}

export const eventBus = new EventBus();
