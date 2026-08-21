import { eq } from 'drizzle-orm';
import { repoInsights, type DB } from '@ninedeploy/db';
import type { RepoInsights } from '@ninedeploy/schemas';

/** Insert-or-replace the stored analysis for a service (1:1 row). */
export async function upsertInsights(db: DB, serviceId: number, insights: RepoInsights): Promise<void> {
  const existing = await db.query.repoInsights.findFirst({ where: eq(repoInsights.serviceId, serviceId) });
  const values = {
    frameworkId: insights.framework.id,
    data: insights as unknown as Record<string, unknown>,
    commitSha: insights.commitSha ?? null,
  };
  if (existing) {
    await db.update(repoInsights).set(values).where(eq(repoInsights.serviceId, serviceId));
  } else {
    await db.insert(repoInsights).values({ serviceId, ...values });
  }
}

/** Stored row → API representation (the JSON column already holds the DTO). */
export function serializeInsights(row: typeof repoInsights.$inferSelect): RepoInsights {
  return row.data as unknown as RepoInsights;
}
