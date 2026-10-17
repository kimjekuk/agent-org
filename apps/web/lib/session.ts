import { getDb, schema } from "@agentorg/shared/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** 로그인 세션의 사용자. 세션이 있어도 DB에 없는 사용자(삭제된 계정 등)면 null */
export async function getSessionUser(): Promise<{ id: string; email: string } | null> {
  const id = (await auth())?.user?.id;
  if (!id) return null;
  const [user] = await getDb().select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, id));
  return user ?? null;
}

/** 로그인한 사용자. 없으면 /login (계정이 하나도 없으면 /setup)으로 보낸다. */
export async function requireUser(): Promise<{ id: string; email: string }> {
  const user = await getSessionUser();
  if (!user) redirect((await hasAnyUser()) ? "/login" : "/setup");
  return user;
}

export async function hasAnyUser(): Promise<boolean> {
  return (await getDb().$count(schema.users)) > 0;
}
