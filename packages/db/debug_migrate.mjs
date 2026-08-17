import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { readdirSync } from 'fs';

const client = createClient({ url: ':memory:' });
const db = drizzle(client);
const folder = 'D:/Codebox/PROJECTS/NineDeploy/packages/db/src/migrations';
const files = readdirSync(folder).filter(f => f.endsWith('.sql')).sort();
console.log('SQL files:', files.length);
console.log('Has 0021:', files.includes('0021_optimal_the_anarchist.sql'));

try {
  await migrate(db, { migrationsFolder: folder });
  console.log('Migrations applied OK');
  const cols = await db.all("PRAGMA table_info(services)");
  console.log('Cols:', cols.map(c => c.name));
} catch(e) {
  console.error('Error:', e.message);
  console.error('Cause:', e.cause?.message);
}
