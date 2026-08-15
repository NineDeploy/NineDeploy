import type { BuildConfig, Service } from '@ninedeploy/db';

export interface BuildContext {
  deploymentId: number;
  service: Service;
  buildConfig?: BuildConfig;
  /** Absolute path to the checked-out working copy. */
  workDir: string;
  /** Resolved commit SHA. */
  commitSha: string;
  /**
   * For image deploys: an explicit image digest to run instead of `service.image`
   * (used by rollback to pin the exact image). When absent, `service.image` is used.
   */
  imageDigest?: string;
  /** Environment variables to inject at runtime (service env vars + attached DB connection strings). */
  env: Record<string, string>;
  /**
   * Private-registry credentials (from a registry-type source): username +
   * password used to `docker login` before pulling the image. Absent for
   * public registries.
   */
  registryAuth?: { username: string; password: string; server?: string };
  /**
   * Remote server this service deploys to (null = this host). Builders route
   * their docker/git operations through the typed agent protocol when set.
   */
  serverId?: number;
  /**
   * When serverId is set, the pipeline pre-binds this typed-op caller so
   * builders can run remote operations without touching the DB layer.
   */
  agentCall?: (op: string, params: Record<string, unknown>, sink: (line: string) => void) => Promise<{ exitCode: number; lines: string[] }>;
  /** Append a log line (persisted + broadcast to subscribers). */
  log: (line: string) => void;
}

/** Identifies a running workload so the engine can stop/inspect it later. */
export interface DeployRuntime {
  /** Docker container name or PM2 process name. */
  runtimeId: string;
  port: number | null;
  healthPath: string;
  /** Resolved image digest the runtime is actually running (for exact rollback). */
  imageDigest?: string;
}

/** A runtime backend (Docker / PM2). Implementations live in ./builders. */
export interface Builder {
  buildAndRun(ctx: BuildContext, previous?: DeployRuntime): Promise<DeployRuntime>;
  isHealthy(runtime: DeployRuntime, timeoutMs?: number, directGraceMs?: number, log?: (line: string) => void): Promise<boolean>;
  stop(runtimeId: string): Promise<void>;
}
