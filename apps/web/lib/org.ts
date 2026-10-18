import { getDb, schema } from "@agentorg/shared/db";
import { and, asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";

export const ORG_COOKIE = "org";
export type Org = typeof schema.organizations.$inferSelect;

/** 선택한 조직 (쿠키). 쿠키가 없거나 남의 조직이면 내 첫 조직. 조직이 없으면 null */
export async function getCurrentOrg(userId: string): Promise<Org | null> {
  const db = getDb();
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  if (wanted) {
    const [org] = await db
      .select()
      .from(schema.organizations)
      .where(and(eq(schema.organizations.id, wanted), eq(schema.organizations.ownerId, userId)));
    if (org) return org;
  }
  const [first] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.ownerId, userId))
    .orderBy(asc(schema.organizations.createdAt))
    .limit(1);
  return first ?? null;
}

/** 내 조직인지 확인하고 돌려준다. 아니면 null */
export async function getOwnedOrg(userId: string, orgId: string): Promise<Org | null> {
  const [org] = await getDb()
    .select()
    .from(schema.organizations)
    .where(and(eq(schema.organizations.id, orgId), eq(schema.organizations.ownerId, userId)));
  return org ?? null;
}
