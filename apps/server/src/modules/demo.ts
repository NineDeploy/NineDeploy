import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import {
  buildConfigs,
  databases,
  deployments,
  envVars,
  projects,
  services,
} from '@ninedeploy/db';
import { encrypt, randomToken } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';

export const demoRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.post('/seed', async (req) => {
    const userId = req.user!.id;

    // 1. Create or retrieve Demo Project
    let project = await app.db.query.projects.findFirst({
      where: eq(projects.slug, 'nextjs-demo-stack'),
    });

    if (!project) {
      const [insertedProject] = await app.db
        .insert(projects)
        .values({
          name: 'Next.js Demo Stack',
          slug: 'nextjs-demo-stack',
          description: 'Production-ready Next.js demo suite featuring Docker and PM2 runtimes',
        })
        .returning();
      project = insertedProject!;
      void audit(app.db, userId, 'project.create', project.name);
    }

    // 2. Create PostgreSQL 16 Managed Database
    let db = await app.db.query.databases.findFirst({
      where: eq(databases.slug, 'demo-postgres'),
    });

    // A per-seed random password: the demo DB must never ship with a
    // publicly-known credential (anyone who knows the source could otherwise
    // connect to it over the shared Docker network).
    const dbPassword = randomToken(24);
    const connectionStr = `postgres://nine:${encodeURIComponent(dbPassword)}@nd-db-demo-postgres:5432/app`;

    if (!db) {
      const [insertedDb] = await app.db
        .insert(databases)
        .values({
          projectId: project.id,
          name: 'demo-postgres',
          slug: 'demo-postgres',
          engine: 'postgres',
          version: '16',
          status: 'running',
          containerName: 'nd-db-demo-postgres',
          volumeName: 'nd-db-demo-postgres-data',
          internalHost: 'nd-db-demo-postgres',
          internalPort: 5432,
          username: 'nine',
          passwordEncrypted: encrypt(dbPassword),
          dbName: 'app',
          cpuShares: 512,
          memLimitMb: 512,
        })
        .returning();
      db = insertedDb!;
      void audit(app.db, userId, 'database.create', db.name);
    }

    const createdServices = [];

    // 3. Create Next.js Docker Service
    let dockerSvc = await app.db.query.services.findFirst({
      where: eq(services.slug, 'nextjs-docker-app'),
    });

    if (!dockerSvc) {
      const [insertedDocker] = await app.db
        .insert(services)
        .values({
          projectId: project.id,
          name: 'Next.js Docker App',
          slug: 'nextjs-docker-app',
          type: 'docker',
          image: 'nginxdemos/hello:plain-text',
          port: 80,
          publishedPort: 3000,
          healthPath: '/',
          status: 'running',
          runtimeId: 'docker-nextjs-demo-container',
          commitSha: '9f8e7d6',
          cpuShares: 512,
          memLimitMb: 512,
        })
        .returning();
      dockerSvc = insertedDocker!;

      // Insert Docker Environment Variables
      await app.db.insert(envVars).values([
        {
          serviceId: dockerSvc.id,
          scope: 'service',
          scopeKey: dockerSvc.id,
          key: 'DATABASE_URL',
          valueEncrypted: encrypt(connectionStr),
          isSecret: true,
        },
        {
          serviceId: dockerSvc.id,
          scope: 'service',
          scopeKey: dockerSvc.id,
          key: 'NODE_ENV',
          valueEncrypted: encrypt('production'),
          isSecret: false,
        },
        {
          serviceId: dockerSvc.id,
          scope: 'service',
          scopeKey: dockerSvc.id,
          key: 'PORT',
          valueEncrypted: encrypt('80'),
          isSecret: false,
        },
      ]);

      // Insert Initial Deployment Record
      await app.db.insert(deployments).values({
        serviceId: dockerSvc.id,
        status: 'running',
        commitSha: '9f8e7d6',
        trigger: 'user',
        message: 'Initial deployment: Next.js standalone container image',
      });

      void audit(app.db, userId, 'service.create', dockerSvc.name);
    }

    createdServices.push({
      id: dockerSvc.id,
      name: dockerSvc.name,
      type: dockerSvc.type,
      status: dockerSvc.status,
      port: dockerSvc.port,
    });

    // 4. Create Next.js PM2 Service
    let pm2Svc = await app.db.query.services.findFirst({
      where: eq(services.slug, 'nextjs-pm2-service'),
    });

    if (!pm2Svc) {
      const [insertedPm2] = await app.db
        .insert(services)
        .values({
          projectId: project.id,
          name: 'Next.js PM2 Service',
          slug: 'nextjs-pm2-service',
          type: 'pm2',
          branch: 'main',
          repoUrl: 'https://github.com/vercel/next-learn',
          port: 3001,
          publishedPort: 3001,
          healthPath: '/',
          status: 'running',
          runtimeId: 'pm2-nextjs-demo-process',
          commitSha: 'a1b2c3d',
          cpuShares: 512,
          memLimitMb: 512,
        })
        .returning();
      pm2Svc = insertedPm2!;

      // Insert PM2 Build Configuration
      await app.db.insert(buildConfigs).values({
        serviceId: pm2Svc.id,
        buildPack: 'auto',
        baseDir: '/basics/learn-starter',
        installCmd: 'npm install',
        buildCmd: 'npm run build',
        startCmd: 'npm start -- -p 3001',
      });

      // Insert PM2 Environment Variables
      await app.db.insert(envVars).values([
        {
          serviceId: pm2Svc.id,
          scope: 'service',
          scopeKey: pm2Svc.id,
          key: 'DATABASE_URL',
          valueEncrypted: encrypt(connectionStr),
          isSecret: true,
        },
        {
          serviceId: pm2Svc.id,
          scope: 'service',
          scopeKey: pm2Svc.id,
          key: 'NODE_ENV',
          valueEncrypted: encrypt('production'),
          isSecret: false,
        },
        {
          serviceId: pm2Svc.id,
          scope: 'service',
          scopeKey: pm2Svc.id,
          key: 'PORT',
          valueEncrypted: encrypt('3001'),
          isSecret: false,
        },
      ]);

      // Insert Initial Deployment Record
      await app.db.insert(deployments).values({
        serviceId: pm2Svc.id,
        status: 'running',
        commitSha: 'a1b2c3d',
        trigger: 'user',
        message: 'Initial deployment: Next.js Node.js server under PM2 cluster',
      });

      void audit(app.db, userId, 'service.create', pm2Svc.name);
    }

    createdServices.push({
      id: pm2Svc.id,
      name: pm2Svc.name,
      type: pm2Svc.type,
      status: pm2Svc.status,
      port: pm2Svc.port,
    });

    return {
      ok: true,
      projectId: project.id,
      projectName: project.name,
      services: createdServices,
      database: {
        id: db.id,
        name: db.name,
        engine: db.engine,
      },
    };
  });
};
