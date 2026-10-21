"use server";

import { writeAudit } from "@agentorg/shared/audit";
import { getDb, schema } from "@agentorg/shared/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

/** F016 출근 브리핑 닫기 — 다음 브리핑은 지금 이후의 일만 요약한다 */
export async function dismissBriefing() {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  await getDb().transaction(async (tx) => {
    await tx.update(schema.users).set({ briefingSeenAt: new Date() }).where(eq(schema.users.id, user.id));
    await writeAudit(tx, { orgId: org?.id ?? null, actorType: "USER", actorId: user.id, action: "briefing.dismiss", targetType: "user", targetId: user.id, reasoning: "출근 브리핑을 읽고 닫았습니다" }); // i18n-ignore
  });
  revalidatePath("/dashboard");
}
