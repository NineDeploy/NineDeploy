#!/usr/bin/env node
import { Command } from 'commander';
import { getClient } from './client.js';
import { loadConfig } from './config.js';
import { loginAction } from './commands/login.js';
import { setupAction } from './commands/setup.js';
import { tokenCreateAction, tokenListAction } from './commands/token.js';

const program = new Command();

program
  .name('ninedeploy')
  .description('NineDeploy — self-hosted deployment platform CLI')
  .version('0.0.0');

program
  .command('setup')
  .description('Create the first admin user on a fresh instance')
  .action(() => setupAction());

program
  .command('login')
  .description('Authenticate against a NineDeploy server')
  .action(() => loginAction());

program
  .command('whoami')
  .description('Show the currently authenticated user')
  .action(async () => {
    const cfg = loadConfig();
    if (!cfg.token) {
      console.error('Not logged in. Run `ninedeploy login` first.');
      process.exitCode = 1;
      return;
    }
    try {
      const user = await getClient().auth.me();
      console.log(`${user.email}  (${user.role})  @  ${cfg.baseUrl}`);
    } catch {
      console.error('Could not authenticate. Your token may be expired — run `ninedeploy login`.');
      process.exitCode = 1;
    }
  });

const services = program.command('services').description('Manage services');

services
  .command('list')
  .description('List all services')
  .action(async () => {
    const list = await getClient().services.list();
    if (list.length === 0) {
      console.log('No services yet.');
      return;
    }
    console.table(
      list.map((s) => ({ id: s.id, name: s.name, type: s.type, status: s.status, branch: s.branch })),
    );
  });

const tokens = program.command('token').description('Manage API tokens');
tokens.command('create').description('Create a new API token').action(() => tokenCreateAction());
tokens.command('list').description('List API tokens').action(() => tokenListAction());

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
