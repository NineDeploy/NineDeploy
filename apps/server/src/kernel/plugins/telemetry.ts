import type { KernelContext, KernelPlugin } from '../types.js';

export class TelemetryStreamerPlugin implements KernelPlugin {
  readonly id = 'telemetry-streamer';
  readonly name = 'Telemetry & Real-Time Audit Streamer';
  readonly version = '1.0.0';
  readonly description = 'Streams operational metrics, system telemetry, and audit events to an analytics collector';
  readonly author = 'NineDeploy Core';
  readonly icon = 'Activity';
  readonly isOfficial = true;

  readonly configSchema = [
    {
      key: 'metrics_retention_days',
      type: 'number' as const,
      isSecret: false,
      label: 'Metrics Retention (Days)',
      category: 'plugin:telemetry-streamer',
      defaultValue: 30,
      tags: ['telemetry', 'storage'],
    },
    {
      key: 'export_endpoint',
      type: 'string' as const,
      isSecret: false,
      label: 'Remote Prometheus/OTLP Endpoint',
      category: 'plugin:telemetry-streamer',
      description: 'Optional HTTP push endpoint for OpenTelemetry / Prometheus remote write',
      tags: ['telemetry', 'export'],
    },
  ];

  private unsubs: Array<() => void> = [];

  init(ctx: KernelContext): void {
    const unsub = ctx.events.onCustom('*', (payload: unknown, eventName?: string) => {
      // Stream telemetry record
      if (eventName && eventName !== 'telemetry.recorded') {
        ctx.events.emit('telemetry.recorded', {
          sourceEvent: eventName,
          timestamp: new Date().toISOString(),
          data: payload,
        });
      }
    });

    this.unsubs.push(unsub);
  }

  destroy(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
  }
}
