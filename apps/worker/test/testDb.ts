// 테스트용 PostgreSQL (PGlite, 메모리). 운영과 같은 마이그레이션을 적용한다.
import { fileURLToPath } from "node:url";
import type { AnyDb } from "@agentorg/shared/db";
import * as schema from "@agentorg/shared/db/schema";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const migrationsFolder = fileURLToPath(new URL("../../../packages/shared/drizzle", import.meta.url));

export async function createTestDb(): Promise<AnyDb> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as AnyDb;
}

/** 사용자 1명 + 조직 1개 + 에이전트 1명 */
export async function seed(db: AnyDb, opts: { budgetDaily?: number; maxTurns?: number } = {}) {
  const [user] = await db.insert(schema.users).values({ email: "owner@example.test", passwordHash: "x" }).returning();
  const [org] = await db
    .insert(schema.organizations)
    .values({ ownerId: user.id, name: "테스트 조직", budgetDaily: opts.budgetDaily ?? 1000 })
    .returning();
  const [agent] = await db
    .insert(schema.agents)
    .values({ orgId: org.id, name: "리서처", maxTurns: opts.maxTurns ?? 5 })
    .returning();
  return { user, org, agent };
}
