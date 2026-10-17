import { getDb, schema } from "@agentorg/shared/db";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** 로그인한 사용자. 없으면 /login (계정이 하나도 없으면 /setup)으로 보낸다. */
export async function requireUser(): Promise<{ id: string; email: string }> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect((await hasAnyUser()) ? "/login" : "/setup");
  return { id, email: session.user?.email ?? "" };
}

export async function hasAnyUser(): Promise<boolean> {
  return (await getDb().$count(schema.users)) > 0;
}
