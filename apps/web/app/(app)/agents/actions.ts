"use server";

// F005 에이전트 채용·프로필 · F009 사용자 직접 지시. 모든 변경은 AuditLog에 기록한다 (CLAUDE.md 절대 규칙 4).
import { isLanguage } from "@agentorg/shared/agents/language";
import { isPersonalityType, isSpeechTone } from "@agentorg/shared/agents/personality";
import { AGENT_DEFAULTS, type AgentTemplate, CONTENT_TEAM, defaultModelFor, normalizeAvatar, ROLE_TEMPLATES, type ToolPermissions } from "@agentorg/shared/agents/templates";
import { writeAudit } from "@agentorg/shared/audit";
import { type AnyDb, getDb, schema } from "@agentorg/shared/db";
import { publishOrgEvent } from "@agentorg/shared/events";
import { listModelChoices } from "@agentorg/shared/llm/models";
import { DEFAULT_MODELS, supportsCodeExecution } from "@agentorg/shared/llm/pricing";
import { enqueueAgentRun } from "@agentorg/shared/queue";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOrgAgent } from "@/lib/agents";
import { getT } from "@/lib/i18n";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export type FormState = { error?: string; ok?: string } | undefined;

async function context() {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) redirect("/settings");
  return { user, org };
}

async function insertAgent(db: AnyDb, orgId: string, userId: string, t: AgentTemplate, name: string, supervisorId: string | null) {
  const [agent] = await db
    .insert(schema.agents)
    .values({
      orgId,
      name,
      rank: t.rank,
      personality: t.personality,
      personalityType: t.personalityType,
      skills: t.skills,
      avatar: t.avatar,
      toolPermissions: t.toolPermissions,
      supervisorId,
      modelPrimary: defaultModelFor(t.toolPermissions),
      modelEconomy: AGENT_DEFAULTS.modelEconomy,
      maxTurns: AGENT_DEFAULTS.maxTurns,
    })
    .returning();
  await writeAudit(db, {
    orgId,
    actorType: "USER",
    actorId: userId,
    action: "agent.hire",
    targetType: "agent",
    targetId: agent.id,
    reasoning: `${t.title} 템플릿으로 "${name}" 채용`, // i18n-ignore
  });
  return agent;
}

/** 콘텐츠 제작팀 4명 한 번에 채용 (리더가 나머지의 상사) — PRD 2장 첫 조직 템플릿 */
export async function hireContentTeam() {
  const { user, org } = await context();
  await getDb().transaction(async (tx) => {
    const [leaderT, ...members] = CONTENT_TEAM;
    const leader = await insertAgent(tx, org.id, user.id, leaderT, leaderT.name, null);
    for (const t of members) await insertAgent(tx, org.id, user.id, t, t.name, leader.id);
  });
  await publishOrgEvent(org.id, { type: "agent", agentId: "" });
  revalidatePath("/agents");
}

export async function hireAgent(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org } = await context();
  const t = await getT();
  const tpl = ROLE_TEMPLATES.find((r) => r.key === form.get("template"));
  const name = String(form.get("name") ?? "").trim();
  if (!tpl) return { error: t("역할을 골라 주세요") };
  if (name.length < 1 || name.length > 20) return { error: t("이름은 1~20자로 입력해 주세요") };
  const agent = await getDb().transaction((tx) => insertAgent(tx, org.id, user.id, tpl, name, null));
  revalidatePath("/agents");
  redirect(`/agents/${agent.id}`);
}

export async function updateAgent(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org } = await context();
  const t = await getT();
  const agent = await getOrgAgent(org.id, String(form.get("id")));
  if (!agent) return { error: t("에이전트를 찾을 수 없습니다") };

  const name = String(form.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 20) return { error: t("이름은 1~20자로 입력해 주세요") };
  const rank = String(form.get("rank"));
  if (!["LEADER", "MANAGER", "MEMBER"].includes(rank)) return { error: t("직급이 올바르지 않습니다") };
  const supervisorId = String(form.get("supervisorId") ?? "") || null;
  if (supervisorId && (supervisorId === agent.id || !(await getOrgAgent(org.id, supervisorId)))) return { error: t("상사를 다시 골라 주세요") };
  let modelPrimary = String(form.get("modelPrimary"));
  const modelEconomy = String(form.get("modelEconomy"));
  const choices = await listModelChoices(getDb());
  if (!choices.some((m) => m.id === modelPrimary) || !choices.some((m) => m.id === modelEconomy)) return { error: t("모델을 다시 골라 주세요 (꺼진 모델은 고를 수 없습니다)") };
  const maxTurns = Number(form.get("maxTurns"));
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 200) return { error: t("최대 턴 수는 1~200 사이로 입력해 주세요") };
  const budgetRaw = String(form.get("budgetLimit") ?? "").trim();
  const budgetLimit = budgetRaw === "" ? null : Number(budgetRaw);
  if (budgetLimit !== null && (!Number.isInteger(budgetLimit) || budgetLimit < 0)) return { error: t("예산 한도는 0 이상의 원 단위 숫자로 입력해 주세요") };
  const skills = String(form.get("skills") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  const toolPermissions: ToolPermissions = {
    web_search: form.get("tool_web_search") === "on",
    document: form.get("tool_document") === "on",
    qa_review: form.get("tool_qa_review") === "on",
    code_exec: form.get("tool_code_exec") === "on",
  };
  // F110: 코드 실행을 새로 켰는데 그 도구를 못 쓰는 모델(Haiku 등)이면 Sonnet으로 바꾼다 (2026-10-19 결정)
  const before = (agent.toolPermissions ?? {}) as ToolPermissions;
  const switched = toolPermissions.code_exec && !before.code_exec && !supportsCodeExecution(modelPrimary);
  if (switched) modelPrimary = DEFAULT_MODELS.search;

  const changes = {
    name,
    rank: rank as typeof agent.rank,
    personality: String(form.get("personality") ?? "").trim().slice(0, 200) || null,
    personalityType: isPersonalityType(form.get("personalityType")) ? String(form.get("personalityType")) : null,
    speechTone: isSpeechTone(form.get("speechTone")) ? String(form.get("speechTone")) : null,
    language: isLanguage(form.get("language")) ? String(form.get("language")) : null,
    skills,
    supervisorId,
    modelPrimary,
    modelEconomy,
    maxTurns,
    budgetLimit,
    toolPermissions,
  };
  await getDb().transaction(async (tx) => {
    await tx.update(schema.agents).set(changes).where(eq(schema.agents.id, agent.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "agent.update",
      targetType: "agent",
      targetId: agent.id,
      reasoning: "사용자가 프로필을 수정했습니다", // i18n-ignore
      payload: changes,
    });
  });
  await publishOrgEvent(org.id, { type: "agent", agentId: agent.id });
  revalidatePath(`/agents/${agent.id}`);
  return { ok: switched ? t("저장했습니다. 코드 실행은 Claude Sonnet·Opus만 되어 기본 모델을 Sonnet 5.5로 바꿨습니다.") : t("저장했습니다") };
}

export async function cloneAgent(form: FormData) {
  const { user, org } = await context();
  const agent = await getOrgAgent(org.id, String(form.get("id")));
  if (!agent) return;
  const copy = await getDb().transaction(async (tx) => {
    // 설정만 복사한다 (상태·경험치·레벨은 새로 시작)
    const [c] = await tx
      .insert(schema.agents)
      .values({
        orgId: agent.orgId,
        name: `${agent.name} 2`.slice(0, 20),
        avatar: agent.avatar,
        personality: agent.personality,
        personalityType: agent.personalityType,
        rank: agent.rank,
        supervisorId: agent.supervisorId,
        skills: agent.skills,
        modelPrimary: agent.modelPrimary,
        modelEconomy: agent.modelEconomy,
        maxTurns: agent.maxTurns,
        toolPermissions: agent.toolPermissions,
        budgetLimit: agent.budgetLimit,
        autonomy: agent.autonomy,
        isActive: agent.isActive,
      })
      .returning();
    await writeAudit(tx, { orgId: org.id, actorType: "USER", actorId: user.id, action: "agent.clone", targetType: "agent", targetId: c.id, reasoning: `"${agent.name}" 복제` }); // i18n-ignore
    return c;
  });
  redirect(`/agents/${copy.id}`);
}

/** 해고(비활성) ↔ 재고용 */
export async function toggleActive(form: FormData) {
  const { user, org } = await context();
  const agent = await getOrgAgent(org.id, String(form.get("id")));
  if (!agent) return;
  await getDb().transaction(async (tx) => {
    await tx.update(schema.agents).set({ isActive: !agent.isActive, status: "IDLE" }).where(eq(schema.agents.id, agent.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: agent.isActive ? "agent.fire" : "agent.rehire",
      targetType: "agent",
      targetId: agent.id,
      reasoning: agent.isActive ? "사용자가 해고(비활성)했습니다" : "사용자가 재고용했습니다", // i18n-ignore
    });
  });
  if (!agent.isActive && (await hasUnreadDirective(agent.id))) await enqueueAgentRun({ orgId: org.id, agentId: agent.id });
  await publishOrgEvent(org.id, { type: "agent", agentId: agent.id });
  revalidatePath(`/agents/${agent.id}`);
}

/** 이 에이전트만 멈춤 ↔ 재개. 재개하면 남은 지시를 이어서 처리한다 */
export async function togglePause(form: FormData) {
  const { user, org } = await context();
  const agent = await getOrgAgent(org.id, String(form.get("id")));
  if (!agent) return;
  const pausing = agent.status !== "PAUSED";
  await getDb().transaction(async (tx) => {
    await tx.update(schema.agents).set({ status: pausing ? "PAUSED" : "IDLE" }).where(eq(schema.agents.id, agent.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: pausing ? "agent.pause" : "agent.unpause",
      targetType: "agent",
      targetId: agent.id,
      reasoning: pausing ? "사용자가 이 에이전트를 멈췄습니다" : "사용자가 이 에이전트를 다시 움직였습니다", // i18n-ignore
    });
  });
  if (!pausing && (await hasUnreadDirective(agent.id))) await enqueueAgentRun({ orgId: org.id, agentId: agent.id });
  await publishOrgEvent(org.id, { type: "agent", agentId: agent.id });
  revalidatePath(`/agents/${agent.id}`);
}

export async function deleteAgent(form: FormData) {
  const { user, org } = await context();
  const agent = await getOrgAgent(org.id, String(form.get("id")));
  if (!agent) return;
  await getDb().transaction(async (tx) => {
    await tx.delete(schema.agents).where(eq(schema.agents.id, agent.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "agent.delete",
      targetType: "agent",
      targetId: agent.id,
      reasoning: `"${agent.name}" 삭제`, // i18n-ignore
    });
  });
  await publishOrgEvent(org.id, { type: "agent", agentId: agent.id });
  redirect("/agents");
}

// ── F009 사용자 직접 지시 ──────────────────────────────

export async function sendDirective(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org } = await context();
  const t = await getT();
  const agent = await getOrgAgent(org.id, String(form.get("id")));
  if (!agent) return { error: t("에이전트를 찾을 수 없습니다") };
  const content = String(form.get("content") ?? "").trim();
  if (content.length < 1 || content.length > 4000) return { error: t("지시는 1~4,000자로 입력해 주세요") };

  await getDb().transaction(async (tx) => {
    const [msg] = await tx
      .insert(schema.messages)
      .values({ orgId: org.id, senderType: "USER", receiverAgentId: agent.id, type: "DIRECTIVE", content, priority: 100 })
      .returning({ id: schema.messages.id });
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "message.directive",
      targetType: "message",
      targetId: msg.id,
      reasoning: `"${agent.name}"에게 직접 지시`, // i18n-ignore
    });
  });
  const queued = await enqueueAgentRun({ orgId: org.id, agentId: agent.id });
  await publishOrgEvent(org.id, { type: "message", agentId: agent.id });
  revalidatePath(`/agents/${agent.id}`);

  const notes = [];
  if (!queued) notes.push(t("작업 대기열 연결이 늦어 최대 2분 뒤 시작합니다"));
  if (org.emergencyStop) notes.push(t("긴급 정지 중이라 재개하면 처리합니다"));
  if (!agent.isActive) notes.push(t("해고된 에이전트라 재고용해야 처리합니다"));
  if (agent.status === "PAUSED") notes.push(t("멈춘 에이전트라 재개해야 처리합니다"));
  return { ok: notes.length ? t("지시를 보냈습니다. {notes}.", { notes: notes.join(", ") }) : t("지시를 보냈습니다. 처리가 끝나면 아래에 보고가 올라옵니다.") };
}

async function hasUnreadDirective(agentId: string): Promise<boolean> {
  const [m] = await getDb()
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(eq(schema.messages.receiverAgentId, agentId), eq(schema.messages.type, "DIRECTIVE"), isNull(schema.messages.readAt)))
    .limit(1);
  return Boolean(m);
}

// ── F202 캐릭터 꾸미기: 미리보기에서 고른 파츠를 저장 ─────────────────────────────

export async function saveAvatar(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, org } = await context();
  const t = await getT();
  const agent = await getOrgAgent(org.id, String(form.get("id")));
  if (!agent) return { error: t("에이전트를 찾을 수 없습니다") };
  const avatar = normalizeAvatar({
    hair: form.get("hair"),
    face: form.get("face"),
    color: form.get("color"),
    hairColor: form.get("hairColor"),
    skin: form.get("skin"),
    outfit: form.get("outfit"),
    accessory: form.get("accessory"),
  });
  await getDb().transaction(async (tx) => {
    await tx.update(schema.agents).set({ avatar }).where(eq(schema.agents.id, agent.id));
    await writeAudit(tx, {
      orgId: org.id,
      actorType: "USER",
      actorId: user.id,
      action: "agent.update",
      targetType: "agent",
      targetId: agent.id,
      reasoning: "캐릭터 꾸미기 저장", // i18n-ignore
      payload: { from: agent.avatar, to: avatar },
    });
  });
  await publishOrgEvent(org.id, { type: "agent", agentId: agent.id });
  revalidatePath(`/agents/${agent.id}`);
  return { ok: t("캐릭터를 저장했습니다") };
}
