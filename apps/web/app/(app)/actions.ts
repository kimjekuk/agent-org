"use server";

// F014 긴급 정지 / 재개. 재개는 사용자만 할 수 있다 (PRD F014). 모든 변경은 AuditLog에 기록한다.
import { writeAudit } from "@agentorg/shared/audit";
import { getDb, schema } from "@agentorg/shared/db";
import { publishOrgEvent } from "@agentorg/shared/events";
import { agentsWithPendingDirectives, enqueueAgentRun } from "@agentorg/shared/queue";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getOwnedOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export async function emergencyStop(orgId: string) {
  const user = await requireUser();
  if (!(await getOwnedOrg(user.id, orgId))) return;
  await getDb().transaction(async (tx) => {
    await tx.update(schema.organizations).set({ emergencyStop: true }).where(eq(schema.organizations.id, orgId));
    await writeAudit(tx, {
      orgId,
      actorType: "USER",
      actorId: user.id,
      action: "org.emergency_stop",
      targetType: "organization",
      targetId: orgId,
      reasoning: "사용자가 긴급 정지 버튼을 눌렀습니다 — 모든 에이전트는 다음 턴 시작 전에 멈춥니다", // i18n-ignore
    });
  });
  await publishOrgEvent(orgId, { type: "org" });
  revalidatePath("/", "layout");
}

export async function resumeOrg(orgId: string) {
  const user = await requireUser();
  if (!(await getOwnedOrg(user.id, orgId))) return;
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(schema.organizations).set({ emergencyStop: false }).where(eq(schema.organizations.id, orgId));
    await writeAudit(tx, {
      orgId,
      actorType: "USER",
      actorId: user.id,
      action: "org.resume",
      targetType: "organization",
      targetId: orgId,
      reasoning: "사용자가 긴급 정지를 해제했습니다", // i18n-ignore
    });
  });

  // 멈춰 있던 동안 남은 지시(리더가 검토할 보고 포함)가 있는 에이전트들을 다시 깨운다
  for (const job of await agentsWithPendingDirectives(db, orgId)) await enqueueAgentRun(job);

  await publishOrgEvent(orgId, { type: "org" });
  revalidatePath("/", "layout");
}
