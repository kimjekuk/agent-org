"use server";

// F004 조직도: 상사·직급 변경 (모바일·PC 모두 탭 → 메뉴, 2026-10-18 결정). 변경은 즉시 저장 + AuditLog
import { writeAudit } from "@agentorg/shared/audit";
import { getDb, schema } from "@agentorg/shared/db";
import { publishOrgEvent } from "@agentorg/shared/events";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOrgAgent, RANK_LABEL } from "@/lib/agents";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export type FormState = { error?: string; ok?: string } | undefined;

export async function updatePlacement(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  const agent = await getOrgAgent(org.id, String(form.get("id")));
  if (!agent) return { error: "에이전트를 찾을 수 없습니다" };
  const rank = String(form.get("rank")) as keyof typeof RANK_LABEL;
  if (!(rank in RANK_LABEL)) return { error: "직급을 골라 주세요" };
  const supervisorId = String(form.get("supervisorId") ?? "") || null;

  if (supervisorId) {
    if (supervisorId === agent.id) return { error: "자기 자신을 상사로 정할 수 없습니다" };
    // 순환 방지: 새 상사가 이 에이전트의 부하(아래 단계)면 안 된다
    const all = await getDb().select({ id: schema.agents.id, supervisorId: schema.agents.supervisorId }).from(schema.agents).where(eq(schema.agents.orgId, org.id));
    const parent = new Map(all.map((a) => [a.id, a.supervisorId]));
    if (!parent.has(supervisorId)) return { error: "상사를 다시 골라 주세요" };
    for (let cur: string | null | undefined = supervisorId, i = 0; cur && i < 100; cur = parent.get(cur), i++) {
      if (cur === agent.id) return { error: "부하 직원을 상사로 정할 수 없습니다" };
    }
  }
  if (supervisorId === agent.supervisorId && rank === agent.rank) return { ok: "바뀐 것이 없습니다" };

  const names = new Map((await getDb().select({ id: schema.agents.id, name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.orgId, org.id))).map((a) => [a.id, a.name]));
  await getDb().transaction(async (tx) => {
    await tx.update(schema.agents).set({ supervisorId, rank }).where(eq(schema.agents.id, agent.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "agent.reorg",
      targetType: "agent",
      targetId: agent.id,
      reasoning: `"${agent.name}" → ${RANK_LABEL[rank]}, 상사 ${supervisorId ? names.get(supervisorId) : "없음(최상위)"}`,
      payload: { from: { supervisorId: agent.supervisorId, rank: agent.rank }, to: { supervisorId, rank } },
    });
  });
  await publishOrgEvent(org.id, { type: "agent", agentId: agent.id });
  revalidatePath("/org");
  return { ok: "저장했습니다" };
}
