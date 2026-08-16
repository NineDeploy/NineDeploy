import { buildApp } from './app.js';
import { tokenMatches } from './lib/agentClient.js';
import { spawnValidated } from './lib/spawnValidated.js';
import { notifyReady, startWatchdog } from './lib/sdNotify.js';

/**
 * Agent mode (NINEDEPLOY_AGENT=1): a minimal HTTP surface for the core to run
 * DEPLOY OPERATIONS on this host. The request never carries a program name or
 * a raw argv — it names a typed operation from the fixed table below, and the
 * argv is constructed from literal flags plus strictly-validated operands
 * (identifier-like strings, image refs, paths without traversal). Actual
 * process spawning happens exclusively through lib/spawnValidated.ts (one
 * auditable choke point over the two fixed executables).
 */

// ── operand validators ────────────────────────────────────────────────────
const RE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/; // container/volume/project names, slugs
const RE_IMAGE = /^[A-Za-z0-9][A-Za-z0-9@:/._-]*$/; // image refs incl. digests, registries
const RE_PATH = /^[A-Za-z0-9@._][A-Za-z0-9@._/-]*$|^\/[A-Za-z0-9@._/-]*$/; // relative or absolute, no traversal up
const RE_SHA = /^(HEAD|[0-9a-f]{6,64})$/;
const RE_REF = /^[A-Za-z0-9@:/._-]+$/; // branches, tags, URLs

type Params = Record<string, unknown>;

const str = (p: Params, k: string): string | undefined => (typeof p[k] === 'string' ? (p[k] as string) : undefined);

function validated(value: string | undefined, re: RegExp, what: string): string {
  if (value === undefined || !re.test(value)) throw new Error(`Invalid ${what}`);
  return value;
}

/** Typed operation table: op name → executable + argv template builder. */
type Op = (p: Params) => string[];

const OPS: Record<string, { exe: 'docker' | 'git'; build: Op }> = {
  'docker.pull': { exe: 'docker', build: (p) => ['pull', validated(str(p, 'image'), RE_IMAGE, 'image')] },
  'docker.build': {
    exe: 'docker',
    build: (p) => [
      'build', '-t', validated(str(p, 'tag'), RE_IMAGE, 'tag'),
      '-f', validated(str(p, 'dockerfile'), RE_PATH, 'dockerfile'),
      validated(str(p, 'context'), RE_PATH, 'context'),
    ],
  },
  'docker.run': {
    exe: 'docker',
    build: (p) => {
      const argv = ['run', '-d', '--name', validated(str(p, 'name'), RE_NAME, 'name'), '--restart', 'unless-stopped', '--network', 'ninedeploy'];
      const cpu = str(p, 'cpuShares');
      if (cpu !== undefined) argv.push('--cpu-shares', /^\d{1,6}$/.test(cpu) ? cpu : '0');
      const mem = str(p, 'memLimitMb');
      if (mem !== undefined) argv.push('--memory', `${/^\d{1,6}$/.test(mem) ? mem : '0'}m`);
      const vol = str(p, 'volume');
      if (vol !== undefined) argv.push('-v', `${validated(vol, RE_NAME, 'volume name')}:${validated(str(p, 'mount') ?? '/', RE_PATH, 'mount path')}`);
      argv.push(validated(str(p, 'image'), RE_IMAGE, 'image'));
      return argv;
    },
  },
  'docker.runEnv': {
    // Like docker.run but with environment variables: the agent writes them to
    // a 0600 temp env-file locally (values never touch argv) and mounts it via
    // --env-file, deleting the file afterwards.
    exe: 'docker',
    build: (p) => {
      const argv = ['run', '-d', '--name', validated(str(p, 'name'), RE_NAME, 'name'), '--restart', 'unless-stopped', '--network', 'ninedeploy'];
      const cpu = str(p, 'cpuShares');
      if (cpu !== undefined) argv.push('--cpu-shares', /^\d{1,6}$/.test(cpu) ? cpu : '0');
      const mem = str(p, 'memLimitMb');
      if (mem !== undefined) argv.push('--memory', `${/^\d{1,6}$/.test(mem) ? mem : '0'}m`);
      const vol = str(p, 'volume');
      if (vol !== undefined) argv.push('-v', `${validated(vol, RE_NAME, 'volume name')}:${validated(str(p, 'mount') ?? '/', RE_PATH, 'mount path')}`);
      argv.push('--env-file', validated(str(p, 'envFile'), RE_PATH, 'env file path'));
      argv.push(validated(str(p, 'image'), RE_IMAGE, 'image'));
      return argv;
    },
  },
  'docker.stop': { exe: 'docker', build: (p) => ['stop', '-t', '5', validated(str(p, 'name'), RE_NAME, 'name')] },
  'docker.rm': { exe: 'docker', build: (p) => ['rm', '-f', validated(str(p, 'name'), RE_NAME, 'name')] },
  'docker.inspect': {
    exe: 'docker',
    build: (p) => {
      const format = str(p, 'format');
      const safe = format === 'state' ? '{{.State.Status}}|{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' : '{{.Image}}';
      return ['inspect', validated(str(p, 'name'), RE_NAME, 'name'), '--format', safe];
    },
  },
  'docker.logs': { exe: 'docker', build: (p) => ['logs', '--tail', '300', '--timestamps', validated(str(p, 'name'), RE_NAME, 'name')] },
  'docker.login': {
    exe: 'docker',
    build: (p) => {
      const argv = ['login', '--username', validated(str(p, 'username'), RE_NAME, 'username'), '--password-stdin'];
      const server = str(p, 'server');
      if (server) argv.push(validated(server, RE_IMAGE, 'registry server'));
      return argv;
    },
  },
  'docker.logout': {
    exe: 'docker',
    build: (p) => {
      const argv = ['logout'];
      const server = str(p, 'server');
      if (server) argv.push(validated(server, RE_IMAGE, 'registry server'));
      return argv;
    },
  },
  // ── user-defined network management (typed, same validation model) ──────
  'docker.networkCreate': {
    exe: 'docker',
    build: (p) => {
      const argv = ['network', 'create'];
      const driver = str(p, 'driver');
      if (driver !== undefined) argv.push('--driver', driver === 'bridge' || driver === 'overlay' ? driver : 'bridge');
      argv.push(validated(str(p, 'name'), RE_NAME, 'network name'));
      return argv;
    },
  },
  'docker.networkRm': {
    exe: 'docker',
    build: (p) => ['network', 'rm', validated(str(p, 'name'), RE_NAME, 'network name')],
  },
  'docker.networkConnect': {
    exe: 'docker',
    build: (p) => [
      'network', 'connect',
      validated(str(p, 'network'), RE_NAME, 'network name'),
      validated(str(p, 'container'), RE_NAME, 'container name'),
    ],
  },
  'docker.networkDisconnect': {
    exe: 'docker',
    build: (p) => [
      'network', 'disconnect',
      validated(str(p, 'network'), RE_NAME, 'network name'),
      validated(str(p, 'container'), RE_NAME, 'container name'),
    ],
  },
  'docker.composeUp': {
    exe: 'docker',
    build: (p) => ['compose', '-p', validated(str(p, 'project'), RE_NAME, 'project'), '-f', validated(str(p, 'file'), RE_PATH, 'compose file'), 'up', '-d', '--build', '--remove-orphans'],
  },
  'docker.composeDown': {
    exe: 'docker',
    build: (p) => ['compose', '-p', validated(str(p, 'project'), RE_NAME, 'project'), 'down', '--remove-orphans'],
  },
  'git.clone': {
    exe: 'git',
    build: (p) => {
      const argv = ['clone'];
      const depth = str(p, 'depth');
      if (depth !== undefined) argv.push('--depth', /^\d{1,3}$/.test(depth) ? depth : '1');
      argv.push(validated(str(p, 'url'), RE_REF, 'repo url'), validated(str(p, 'dir') ?? '.', RE_PATH, 'target dir'));
      return argv;
    },
  },
  'git.fetch': { exe: 'git', build: () => ['fetch', '--all'] },
  'git.checkout': { exe: 'git', build: (p) => ['checkout', validated(str(p, 'ref') ?? 'HEAD', RE_REF, 'ref')] },
  'git.rev-parse': { exe: 'git', build: () => ['rev-parse', 'HEAD'] },
  'git.reset': { exe: 'git', build: (p) => ['reset', '--hard', validated(str(p, 'sha') ?? 'HEAD', RE_SHA, 'commit sha')] },
};

/** Env files the agent writes for docker.runEnv live under this fixed dir. */
const ENV_DIR = '.agent-env';

/** Write an env file (KEY=VALUE lines) for a subsequent docker.runEnv call. */
async function writeEnvFileOp(params: Params): Promise<{ path: string }> {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const pathmod = await import('node:path');
  const base = pathmod.join(process.cwd(), ENV_DIR);
  const name = validated(str(params, 'name'), RE_NAME, 'env file name');
  const entries = params['env'];
  if (typeof entries !== 'object' || entries === null) throw new Error('Invalid env');
  const lines: string[] = [];
  for (const [k, v] of Object.entries(entries as Record<string, unknown>)) {
    if (!RE_NAME.test(k) || typeof v !== 'string' || v.includes('\n') || v.includes('\0') || v.length > 32768) {
      throw new Error(`Invalid env value for ${k}`);
    }
    lines.push(`${k}=${v}`);
  }
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const file = pathmod.join(base, `${name}.env`);
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
  return { path: `${ENV_DIR}/${name}.env` };
}

/** Remove an env file written earlier (best-effort). */
async function deleteEnvFileOp(params: Params): Promise<void> {
  const { rmSync } = await import('node:fs');
  const pathmod = await import('node:path');
  const name = validated(str(params, 'name'), RE_NAME, 'env file name');
  rmSync(pathmod.join(process.cwd(), ENV_DIR, `${name}.env`), { force: true });
}

/** Run one typed operation (exported for tests). */
export async function runOp(op: string, params: Params, onLine: (l: string) => void): Promise<number> {
  if (op === 'file.writeEnv') {
    const { path } = await writeEnvFileOp(params);
    onLine(`wrote ${path}`);
    return 0;
  }
  if (op === 'file.deleteEnv') {
    await deleteEnvFileOp(params);
    return 0;
  }
  const def = OPS[op];
  if (!def) return -1;
  const argv = def.build(params);
  return spawnValidated(def.exe, argv, onLine);
}

async function main(): Promise<void> {
  const tokenHash = process.env['NINEDEPLOY_AGENT_TOKEN'] ?? '';
  if (!tokenHash) {
    // eslint-disable-next-line no-console
    console.error('NINEDEPLOY_AGENT_TOKEN (sha256 hash of the shared token) is required in agent mode');
    process.exit(1);
  }
  const port = Number(process.env['NINEDEPLOY_AGENT_PORT'] ?? 4600);

  const app = await buildApp();
  await app.register(agentRoutes, { tokenHash });

  await app.listen({ host: '0.0.0.0', port });
  // eslint-disable-next-line no-console
  console.log(`NineDeploy agent listening on :${port} (${Object.keys(OPS).length} typed deploy operations)`);
  notifyReady();
  const stopWatchdog = startWatchdog(30_000);
  const shutdown = () => {
    stopWatchdog();
    void app.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * The agent's HTTP surface, as a registerable plugin (used by main() and by
 * route tests). `tokenHash` is the sha256 of the shared agent token.
 */
export const agentRoutes = async (app: import('fastify').FastifyInstance, opts: { tokenHash?: string }) => {
  const tokenHash = opts.tokenHash ?? process.env['NINEDEPLOY_AGENT_TOKEN'] ?? '';

  app.post('/agent/exec', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = req.headers['x-agent-token'];
    if (typeof token !== 'string' || !tokenMatches(token, tokenHash)) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Bad agent token' } });
    }
    const input = (req.body ?? {}) as { op?: unknown; params?: unknown };
    const op = typeof input.op === 'string' ? input.op : '';
    const params: Params = typeof input.params === 'object' && input.params ? (input.params as Params) : {};
    if (!OPS[op] && op !== 'file.writeEnv' && op !== 'file.deleteEnv') {
      return reply.code(400).send({ error: { code: 'unknown_op', message: `Unknown operation: ${op}` } });
    }
    const lines: string[] = [];
    let exitCode: number;
    // For file.writeEnv, surface the remote env-file path for docker.runEnv.
    let envFile: string | null = null;
    try {
      exitCode = await runOp(op, params, (l) => lines.push(l));
      envFile = lines.find((l) => l.startsWith('wrote '))?.slice('wrote '.length) ?? null;
    } catch (err) {
      return reply.code(400).send({ error: { code: 'bad_params', message: err instanceof Error ? err.message : 'Invalid params' } });
    }
    return { lines, exitCode, envFile };
  });

  app.get('/agent/ping', async () => ({ ok: true, agent: true, version: (await import('./version.js')).VERSION }));
};

// Boot when the agent flag is set. Tests set NINEDEPLOY_AGENT=1 explicitly
// (via test/agentBoot.test.ts) so the boot path stays covered.
if (process.env['NINEDEPLOY_AGENT'] === '1') {
  void main();
}

export const agentMode = { main, OPS };
