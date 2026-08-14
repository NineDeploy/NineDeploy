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
  systemDashboard, systemInfo, tplDeploy, tplList,
  tokenCreate, tokenList,
} from './commands/misc.js';
import {
  activityList, alertsCreate, alertsList, alertsRemove,
  backupsCreate, backupsList, backupsRestore,
  deploysWatch, domainsAdd, domainsList, domainsRemove,
  envList, envRemove, envSet, systemExport, systemImport,
  usersList, volumesList, volumesRemove,
} from './commands/manage.js';

const program = new Command();

program
  .name('ninedeploy')
  .description('NineDeploy — self-hosted deployment platform CLI\n\n  Deploy apps from Git or Docker Hub in one click.')
  .version('1.0.0')
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
  .action(() => {
    saveConfig({ baseUrl: loadConfig().baseUrl });
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
    } catch { console.log('  Token expired. Run `ninedeploy login`.'); process.exit(1); }
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

program.command('activity').description('Show recent activity').action(() => activityList(getClient()));

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
