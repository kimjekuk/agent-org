"use server";

import { writeAudit } from "@agentorg/shared/audit";
import { getDb, schema } from "@agentorg/shared/db";
import { hashPassword } from "@agentorg/shared/password";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";

const SETUP_LOCK = 4201; // 동시에 두 계정이 만들어지지 않도록 하는 advisory lock 번호

export async function createFirstUser(_prev: string | undefined, form: FormData): Promise<string | undefined> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "이메일 형식이 올바르지 않습니다";
  if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다";
  if (password !== confirm) return "비밀번호 확인이 일치하지 않습니다";

  const passwordHash = await hashPassword(password);
  const created = await getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK})`);
    // 계정이 이미 있으면 /setup은 닫혀 있다 (첫 계정만 이 화면으로 만든다)
    if ((await tx.$count(schema.users)) > 0) return false;
    const [user] = await tx.insert(schema.users).values({ email, passwordHash }).returning({ id: schema.users.id });
    await writeAudit(tx, {
      actorType: "USER",
      actorId: user.id,
      action: "user.setup",
      targetType: "user",
      targetId: user.id,
      reasoning: "첫 관리자 계정 생성 (/setup)",
    });
    return true;
  });

  redirect(created ? "/login?setup=1" : "/login");
}
