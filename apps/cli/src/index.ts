#!/usr/bin/env node
import { Command } from 'commander';
import { getClient } from './client.js';
import { loadConfig, saveConfig } from './config.js';
import { banner } from './lib/format.js';
import { loginAction } from './commands/login.js';
import { setupAction } from './commands/setup.js';
import {
  servicesCreate, servicesDelete, servicesDeploy, servicesExport,
  servicesGet, servicesLifecycle, servicesList, servicesLogs,
} from './commands/services.js';
import {
  dbCreate, dbList, deploysList, deploysRollback,
  systemDashboard, systemInfo, systemUpdateCheck, tplDeploy, tplList,
  tokenCreate, tokenList,
} from './commands/misc.js';
import {
  activityList, alertsCreate, alertsList, alertsRemove,
  backupsCreate, backupsList, backupsRestore,
  deploysWatch, domainsAdd, domainsList, domainsRemove,
  envList, envRemove, envSet, networksCreate, networksList, networksRemove,
  sessionsList, sessionsRevoke, systemExport, systemImport,
  usersList, usersResetLink, volumesList, volumesRemove,
} from './commands/manage.js';
import {
  pluginsList, pluginsMarketplace, pluginsInstall,
  pluginsEnable, pluginsDisable, pluginsUninstall,
  pluginsInspect, pluginsReload,
} from './commands/plugins.js';
import {
  configCenterList, configCenterGet, configCenterSet, configCenterDelete,
} from './commands/configCenter.js';
import { demoSeed } from './commands/demo.js';
import {
  workspacesList, workspacesGet, workspacesCreate, workspacesDelete,
} from './commands/workspaces.js';
import { housekeepingPrune } from './commands/housekeeping.js';

const program = new Command();

program
  .name('ninedeploy')
  .description('NineDeploy — self-hosted deployment platform CLI\n\n  Deploy apps from Git or Docker Hub in one click.')
  .version('0.1.0')
  .helpOption('-h, --help', 'Display this help');

// ── Auth ──────────────────────────────────────────────────────────────────
program
  .command('setup')
  .description('Create the first admin user on a fresh instance')
  .action(() => setupAction());

program
  .command('login')
  .description('Authenticate against a NineDeploy server')
  .action(() => loginAction());

program
  .command('logout')
  .description('Clear stored credentials')
  .action(async () => {
    const cfg = loadConfig();
    // Best-effort server-side revoke of the token before dropping it — a
    // network failure must not block the local sign-out.
    if (cfg.token) {
      await getClient().auth.logout().catch(() => undefined);
    }
    saveConfig({ baseUrl: cfg.baseUrl });
    console.log('  ✓ Signed out.');
  });

program
  .command('whoami')
  .description('Show the currently authenticated user and server')
  .action(async () => {
    const cfg = loadConfig();
    if (!cfg.token) { console.log('  Not logged in. Run `ninedeploy login`.'); process.exit(1); }
    try {
      const user = await getClient().auth.me();
      console.log(`  ${user.email}  (${user.role})  @  ${cfg.baseUrl}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  Could not reach the server (${msg}). Check the URL/network, or run \`ninedeploy login\` if the token expired.`);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Show or change the server URL')
  .option('-s, --server <url>', 'Set server URL')
  .action((opts: { server?: string }) => {
    if (opts.server) {
      saveConfig({ baseUrl: opts.server, token: loadConfig().token });
      console.log(`  ✓ Server set to ${opts.server}`);
    } else {
      const cfg = loadConfig();
      console.log(`  Server:  ${cfg.baseUrl}`);
      console.log(`  Token:   ${cfg.token ? '✓ configured' : '✗ not set'}`);
    }
  });

// ── Services ──────────────────────────────────────────────────────────────
const services = program.command('services').description('Manage services');

services.command('list').description('List all services').action(() => servicesList(getClient()));

services.command('create').description('Create a service (interactive wizard)').action(() => servicesCreate(getClient()));

services.command('get <id>').description('Show service details').action((id: string) => servicesGet(getClient(), id));

services.command('deploy <id>').description('Trigger a new deployment').action((id: string) => servicesDeploy(getClient(), id));

services.command('logs <id>').description('View runtime container logs').action((id: string) => servicesLogs(getClient(), id));

services.command('stop <id>').description('Stop a running service').action((id: string) => servicesLifecycle(getClient(), 'stop', id));

services.command('start <id>').description('Start a stopped service').action((id: string) => servicesLifecycle(getClient(), 'start', id));

services.command('restart <id>').description('Restart a service').action((id: string) => servicesLifecycle(getClient(), 'restart', id));

services.command('delete <id>').description('Delete a service (with confirmation)').action((id: string) => servicesDelete(getClient(), id));

services.command('export <id>').description('Export a service as a JSON bundle').action((id: string) => servicesExport(getClient(), id));

// ── Databases ────────────────────────────────────────────────────────────
const databases = program.command('databases').description('Manage databases');

databases.command('list').description('List all databases').action(() => dbList(getClient()));

databases.command('create').description('Create a database (interactive)').action(() => dbCreate(getClient()));

// ── Templates ─────────────────────────────────────────────────────────────
const templates = program.command('templates').description('Browse the template hub');

templates.command('list').description('List all templates').action(() => tplList(getClient()));

templates.command('deploy <id>').description('Deploy a template by ID').action((id: string) => tplDeploy(getClient(), id));

// ── Deploys ───────────────────────────────────────────────────────────────
const deploys = program.command('deploys').description('Manage deployments');

deploys.command('list <serviceId>').description('List deployments for a service').action((id: string) => deploysList(getClient(), id));

deploys.command('rollback <serviceId> <deployId>').description('Rollback to a previous deployment').action((svcId: string, depId: string) => deploysRollback(getClient(), svcId, depId));

// ── Token ─────────────────────────────────────────────────────────────────
const token = program.command('token').description('Manage API tokens');

token.command('create').description('Create a new API token').action(() => tokenCreate(getClient()));

token.command('list').description('List API tokens').action(() => tokenList(getClient()));

// ── System ────────────────────────────────────────────────────────────────
const system = program.command('system').description('System information & tools');

system.command('info').description('Show version, stats, and tech stack').action(() => systemInfo(getClient()));

system.command('dashboard').description('Live dashboard with service health').action(() => systemDashboard(getClient()));
system.command('update-check').description('Compare the running version with the latest release')
  .option('-f, --force', 'Bypass the 6h cache')
  .action((opts: { force?: boolean }) => systemUpdateCheck(getClient(), opts.force === true));

// ── Env vars ──────────────────────────────────────────────────────────────
const envCmd = program.command('env').description('Manage service environment variables');

envCmd.command('list <serviceId>').description('List a service\'s env vars').action((id: string) => envList(getClient(), id));

envCmd.command('set <serviceId> <key> <value>')
  .description('Create or update an env var (secret by default)')
  .option('--public', 'Store as a plain (non-secret) value')
  .action((id: string, key: string, value: string, opts: { public?: boolean }) => envSet(getClient(), id, key, value, opts));

envCmd.command('rm <serviceId> <key>').description('Remove an env var by key').action((id: string, key: string) => envRemove(getClient(), id, key));

// ── Domains ────────────────────────────────────────────────────────────────
const domainsCmd = program.command('domains').description('Manage domains & routing');

domainsCmd.command('list').description('List all domains').action(() => domainsList(getClient()));

domainsCmd.command('add <serviceId> <host>')
  .description('Route a hostname to a service')
  .option('-p, --path <path>', 'Path prefix', '/')
  .option('--no-ssl', 'Serve over plain HTTP (no TLS)')
  .action((id: string, host: string, opts: { path?: string; ssl?: boolean }) => domainsAdd(getClient(), id, host, opts));

domainsCmd.command('rm <serviceId> <domainId>').description('Remove a domain').action((svcId: string, domId: string) => domainsRemove(getClient(), svcId, domId));

// ── Volumes ────────────────────────────────────────────────────────────────
const volumesCmd = program.command('volumes').description('Manage Docker volumes');

volumesCmd.command('list').description('List all volumes').action(() => volumesList(getClient()));

volumesCmd.command('rm <name>').description('Delete a volume (with confirmation)').action((name: string) => volumesRemove(getClient(), name));

// ── Networks ───────────────────────────────────────────────────────────────
const networksCmd = program.command('networks').description('Manage Docker networks');

networksCmd.command('list').description('List user-defined networks').action(() => networksList(getClient()));

networksCmd.command('create <name> [driver]').description('Create a network (bridge|overlay)').action((name: string, driver: string) => networksCreate(getClient(), name, driver === 'overlay' ? 'overlay' : 'bridge'));

networksCmd.command('rm <name>').description('Delete a network (with confirmation)').action((name: string) => networksRemove(getClient(), name));

// ── Sessions ───────────────────────────────────────────────────────────────
const sessionsCmd = program.command('sessions').description('Manage your active sessions');

sessionsCmd.command('list').description('List active sessions').action(() => sessionsList(getClient()));

sessionsCmd.command('revoke <id>').description('Revoke a session').action((id: string) => sessionsRevoke(getClient(), id));

// ── Backups ────────────────────────────────────────────────────────────────
const backupsCmd = program.command('backups').description('Manage database backups');

backupsCmd.command('list [databaseId]').description('List backups (all, or one database\'s)').action((id?: string) => backupsList(getClient(), id));

backupsCmd.command('create <databaseId>').description('Back a database up now').action((id: string) => backupsCreate(getClient(), id));

backupsCmd.command('restore <databaseId> <backupId>').description('Restore a backup (destructive)').action((id: string, bId: string) => backupsRestore(getClient(), id, bId));

// ── Alerts ─────────────────────────────────────────────────────────────────
const alertsCmd = program.command('alerts').description('Manage alert rules');

alertsCmd.command('list').description('List alert rules').action(() => alertsList(getClient()));

alertsCmd.command('create <name> <metric> <operator> <threshold>')
  .description('Create an alert rule (metric: cpu|memory|cert-expiry, operator: > or <)')
  .option('-w, --windows <n>', 'Consecutive 30s samples before firing', '1')
  .option('-s, --service <id>', 'Scope to a service (default: host-wide)')
  .action((name: string, metric: string, op: string, threshold: string, opts: { windows?: string; service?: string }) => alertsCreate(getClient(), name, metric, op, threshold, opts));

alertsCmd.command('rm <id>').description('Delete an alert rule').action((id: string) => alertsRemove(getClient(), id));

// ── Users & activity ───────────────────────────────────────────────────────
program.command('users').description('List users (admin)').action(() => usersList(getClient()));
program.command('reset-link <idOrEmail>').description('Generate a one-time password reset link (admin)')
  .action((who: string) => usersResetLink(getClient(), who));

program.command('activity').description('Show recent activity').action(() => activityList(getClient()));

// ── Plugins & Microkernel ───────────────────────────────────────────────────
const plugins = program.command('plugins').description('Manage plugins and marketplace extensions');
plugins.command('list').description('List all installed plugins').action(() => pluginsList(getClient()));
plugins.command('marketplace').description('Browse verified marketplace extensions').action(() => pluginsMarketplace(getClient()));
plugins.command('inspect <id>').description('Inspect plugin manifest and runtime telemetry').action((id: string) => pluginsInspect(getClient(), id));
plugins.command('install <target>').description('Install a plugin (marketplace, npm, git, local)')
  .option('-s, --source <source>', 'Source type (marketplace, npm, git, local)', 'marketplace')
  .option('-n, --name <name>', 'Custom display name')
  .option('-v, --version <version>', 'Custom version')
  .option('-d, --desc <description>', 'Description')
  .action((target: string, opts: any) => pluginsInstall(getClient(), target, opts));
plugins.command('enable <id>').description('Enable an installed plugin').action((id: string) => pluginsEnable(getClient(), id));
plugins.command('disable <id>').description('Disable a plugin').action((id: string) => pluginsDisable(getClient(), id));
plugins.command('reload <id>').description('Hot-reload a plugin').action((id: string) => pluginsReload(getClient(), id));
plugins.command('uninstall <id>').description('Uninstall a plugin').action((id: string) => pluginsUninstall(getClient(), id));

// ── Configuration Center ────────────────────────────────────────────────────
const configCenter = program.command('config-center').description('Manage central configuration entries and secrets');
configCenter.command('list').description('List configuration entries')
  .option('-c, --category <category>', 'Filter by category')
  .option('-p, --plugin <pluginId>', 'Filter by plugin id')
  .option('-r, --reveal', 'Reveal decrypted secrets (admin only)')
  .action((opts: any) => configCenterList(getClient(), opts));
configCenter.command('get <key>').description('Get a configuration key in detail').action((key: string) => configCenterGet(getClient(), key));
configCenter.command('set <key> <value>').description('Set or update a configuration key')
  .option('-s, --secret', 'Mark as encrypted secret')
  .option('-d, --desc <description>', 'Description')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .action((key: string, value: string, opts: any) => configCenterSet(getClient(), key, value, opts));
configCenter.command('delete <key>').description('Delete a custom configuration key').action((key: string) => configCenterDelete(getClient(), key));

// ── Workspaces & Teams ──────────────────────────────────────────────────────
const workspaces = program.command('workspaces').description('Manage workspaces and team organizations');
workspaces.command('list').description('List accessible workspaces').action(() => workspacesList(getClient()));
workspaces.command('get <id>').description('Get workspace details and team members').action((id: string) => workspacesGet(getClient(), id));
workspaces.command('create <name>').description('Create a new workspace')
  .option('-d, --desc <description>', 'Workspace description')
  .action((name: string, opts: { desc?: string }) => workspacesCreate(getClient(), name, { description: opts.desc }));
workspaces.command('delete <id>').description('Delete a workspace').action((id: string) => workspacesDelete(getClient(), id));

// ── Housekeeping ────────────────────────────────────────────────────────────
system.command('prune').description('Run system housekeeping prune (images, containers, build artifacts)').action(() => housekeepingPrune(getClient()));

// ── Demo Mode ──────────────────────────────────────────────────────────────
const demo = program.command('demo').description('Demo mode operations');
demo.command('seed').description('Seed Next.js Docker + PM2 demo environment with PostgreSQL database').action(() => demoSeed(getClient()));

// ── System export/import + deploy log streaming ────────────────────────────
system.command('export [file]').description('Export the full system state as JSON').action((file?: string) => systemExport(file));

system.command('import <file>').description('Import a system bundle (destructive)').action((file: string) => systemImport(file));

deploys.command('watch <serviceId> <deployId>').description('Stream a deployment\'s build logs live').action((svcId: string, depId: string) => deploysWatch(svcId, depId));

// ── Banner on bare `ninedeploy` ───────────────────────────────────────────
if (process.argv.length <= 2) {
  banner();
  console.log(`  ${'Quick start:'.padEnd(20)} ninedeploy setup`);
  console.log(`  ${'Browse templates:'.padEnd(20)} ninedeploy templates list`);
  console.log(`  ${'Deploy a service:'.padEnd(20)} ninedeploy services create`);
  console.log(`  ${'View dashboard:'.padEnd(20)} ninedeploy system dashboard`);
  console.log(`  ${'Full help:'.padEnd(20)} ninedeploy --help`);
  console.log();
  process.exit(0);
}

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? `\n  ✗ ${err.message}\n` : String(err));
  process.exit(1);
});
