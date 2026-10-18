// F007 리더 루프 (PRD 5장 F007/F008): 미션 수신 → Task 분해 → 배정 → 지시 → 보고 검토 → 최종 통합 → 사용자 보고.
// 메시지 1개 = 한 턴. 턴은 member.ts의 runAgent가 runTurn(guards)으로 실행한다 (CLAUDE.md 절대 규칙 1).
// Task는 순서대로 하나씩 진행하고, 앞 Task 결과를 다음 담당에게 넘긴다 (2026-10-18 결정).
import type { ToolPermissions } from "@agentorg/shared/agents/templates";
import { writeAudit } from "@agentorg/shared/audit";
import type { AnyDb } from "@agentorg/shared/db";
import { agents, approvalRequests, artifacts, messages, missions, tasks } from "@agentorg/shared/db/schema";
import { BudgetExceededError, callLLM, EmergencyStopError, MissingApiKeyError } from "@agentorg/shared/llm/gateway";
import { DEFAULT_MODELS } from "@agentorg/shared/llm/pricing";
import {
  type ApprovalPayload,
  type Autonomy,
  type CheckpointStage,
  MAX_FAILS,
  MAX_REJECTS,
  type MissionMessagePayload,
  missionKind,
  needsCheckpoint,
} from "@agentorg/shared/missions";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { StopReason } from "../guards";
import { buildSystemPrompt } from "../prompts/system";
import { type Agent, clip, type Deps, type Message, type Mission, preview, setStatus, titleOf } from "./common";

type Task = typeof tasks.$inferSelect;
type Db = AnyDb;

const TASK_PRIORITY = 50; // 사용자 직접 지시(100)보다 낮게

/** 이 메시지가 미션 리더가 처리할 일인가 (계획·승인 결과·사용자 메모·Task 이동·통합·Task 보고 검토) */
export function isLeaderWork(mission: Mission, agent: Agent, msg: Message): boolean {
  if (mission.leaderId !== agent.id) return false;
  const kind = missionKind(msg.payload);
  if (kind && kind !== "TASK") return true;
  return msg.type === "REPORT" && Boolean(msg.taskId);
}

/** 리더의 한 턴. 멈춰야 하면 그 이유를 반환한다 (처리 못 한 메시지는 읽지 않은 채로 남는다). */
export async function handleLeaderMessage(db: Db, leader: Agent, mission: Mission, msg: Message, deps: Deps): Promise<StopReason | undefined> {
  const kind = missionKind(msg.payload);
  if (mission.status === "CANCELLED" || (mission.status === "DONE" && kind !== "NOTE")) {
    await markRead(db, msg);
    return undefined;
  }

  const lead = new Leader(db, leader, mission, deps);
  await setStatus(db, leader, "WORKING", `미션 "${preview(mission.title)}" — ${KIND_LABEL[kind ?? "REPORT"]}`, deps.publish);
  try {
    if (kind === "MISSION_START") await lead.plan(msg);
    else if (kind === "APPROVAL") await lead.applyApproval(msg);
    else if (kind === "NOTE") await lead.replyToNote(msg);
    else if (kind === "FINALIZE") await lead.finalize(msg);
    else if (kind === "TASK_MOVED") {
      await markRead(db, msg);
      await lead.advance();
    } else await lead.review(msg);
    await setStatus(db, leader, "IDLE", `미션 "${preview(mission.title)}" — ${KIND_LABEL[kind ?? "REPORT"]} 완료`, deps.publish);
    return undefined;
  } catch (e) {
    if (e instanceof EmergencyStopError) {
      await setStatus(db, leader, "IDLE", "긴급 정지로 작업 중단", deps.publish);
      return "EMERGENCY_STOP";
    }
    if (e instanceof BudgetExceededError) {
      await lead.tellUser(`예산 한도(${e.limitName ?? "예산"})에 도달해 미션을 멈췄습니다. 승인 대기함에서 결정해 주세요.`, { failed: true });
      await setStatus(db, leader, "BLOCKED", "예산 초과로 중단", deps.publish);
      return "BUDGET";
    }
    if (e instanceof MissingApiKeyError) {
      await lead.tellUser(e.message, { failed: true });
      await setStatus(db, leader, "BLOCKED", e.message, deps.publish);
      return "AGENT_INACTIVE";
    }
    await lead.askRetry(msg, (e as Error).message ?? "알 수 없는 오류");
    await setStatus(db, leader, "IDLE", `리더 처리 실패: ${(e as Error).message}`, deps.publish);
    return undefined;
  }
}

const KIND_LABEL: Record<string, string> = {
  MISSION_START: "계획 세우기",
  APPROVAL: "승인 결과 반영",
  NOTE: "사용자 메시지 답변",
  FINALIZE: "최종 결과 통합",
  TASK_MOVED: "Task 이동 반영",
  REPORT: "보고 검토",
};

interface PlanJson {
  summary?: string;
  tasks?: { title?: string; description?: string; skills?: string[]; assignee?: string }[];
}
interface ReviewJson {
  pass?: boolean;
  feedback?: string;
}

class Leader {
  constructor(
    private db: Db,
    private leader: Agent,
    private mission: Mission,
    private deps: Deps,
  ) {}

  private get autonomy(): Autonomy {
    return (this.mission.autonomy ?? "CHECKPOINT") as Autonomy;
  }

  // ── 1~4. 계획: Task 분해 → 특기·부하로 배정 → (체크포인트면 승인 요청) → 첫 Task 지시 ─────────

  async plan(msg: Message, rejectedComment?: string | null) {
    const team = await this.team();
    const previous = rejectedComment ? await this.tasks() : [];
    const prompt = [
      this.brief(),
      `# 팀원\n${team.map((a) => `- ${a.name} (특기: ${((a.skills ?? []) as string[]).join(", ") || "없음"})`).join("\n")}`,
      "# 할 일",
      "미션을 Task 3~8개로 나눠라. Task는 적힌 순서대로 하나씩 진행되고, 앞 Task 결과가 다음 담당에게 전달된다.",
      "각 Task에 필요한 특기와 담당(위 팀원 이름 중 하나)을 정한다. 최종 통합은 리더가 따로 하므로 Task에 넣지 않는다.",
      rejectedComment
        ? `사용자가 이전 계획을 거절했다. 의견을 반영해 다시 세워라.\n이전 계획:\n${previous.map((t, i) => `${i + 1}. ${t.title}`).join("\n")}\n사용자 의견: ${rejectedComment}`
        : "",
      '다른 말 없이 JSON만 답한다: {"summary":"계획 한 줄 요약","tasks":[{"title":"","description":"무엇을 어떤 결과로","skills":["특기"],"assignee":"팀원 이름"}]}',
    ]
      .filter(Boolean)
      .join("\n\n");
    const r = await this.ask("미션 계획 (Task 분해·배정)", prompt, 4000);
    const parsed = parseJsonObject<PlanJson>(r.text);
    const items = (parsed?.tasks ?? []).filter((t) => t?.title?.trim()).slice(0, 8);
    if (items.length === 0) throw new Error("계획(JSON)을 읽지 못했습니다");

    const load = new Map<string, number>();
    const created = await this.db.transaction(async (tx) => {
      // 다시 세우는 경우: 아직 시작하지 않은 Task만 지운다
      await tx.delete(tasks).where(and(eq(tasks.missionId, this.mission.id), eq(tasks.status, "TODO")));
      const rows: (Task & { assigneeName: string })[] = [];
      for (const [i, t] of items.entries()) {
        const skills = (t.skills ?? []).map(String).slice(0, 5);
        const who = pickAssignee(team, t.assignee, skills, load);
        load.set(who.id, (load.get(who.id) ?? 0) + 1);
        const [row] = await tx
          .insert(tasks)
          .values({
            missionId: this.mission.id,
            title: t.title!.trim().slice(0, 120),
            description: (t.description ?? "").trim().slice(0, 2000) || null,
            requiredSkills: skills,
            assigneeId: who.id,
            order: i,
          })
          .returning();
        rows.push({ ...row, assigneeName: who.name });
      }
      await tx.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msg.id));
      await writeAudit(tx, {
        orgId: this.mission.orgId,
        actorType: "AGENT",
        actorId: this.leader.id,
        action: "mission.plan",
        targetType: "mission",
        targetId: this.mission.id,
        reasoning: `${parsed?.summary ?? "계획"} — Task ${rows.length}개 (특기 일치·부하 기준 배정)`,
        payload: { tasks: rows.map((t) => ({ id: t.id, title: t.title, assignee: t.assigneeName, skills: t.requiredSkills })), rejectedComment: rejectedComment ?? null },
      });
      return rows;
    });

    const list = created.map((t, i) => `${i + 1}. ${t.title} — ${t.assigneeName}`).join("\n");
    await this.tellUser(`계획을 세웠습니다 (Task ${created.length}개)${parsed?.summary ? `: ${parsed.summary}` : ""}\n${list}`, { costKrw: r.costKrw, model: r.model });
    if (needsCheckpoint(this.autonomy, "PLAN")) {
      await this.requestApproval("CHECKPOINT", "PLAN", `계획 승인 요청 — "${this.mission.title}"\n${list}`);
    } else {
      await this.advance();
    }
  }

  /** 다음 Task를 지시하거나, 모두 끝났으면 최종 통합을 예약한다. 승인 대기·진행 중인 Task가 있으면 기다린다. */
  async advance() {
    const [m] = await this.db.select().from(missions).where(eq(missions.id, this.mission.id));
    if (!m || m.status !== "RUNNING") return;
    this.mission = m;
    const [open] = await this.db
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.missionId, m.id), inArray(approvalRequests.status, ["PENDING", "HELD"])))
      .limit(1);
    if (open) return;

    const list = await this.tasks();
    if (list.some((t) => t.status === "DOING" || t.status === "REVIEW")) return;
    const next = list.find((t) => t.status === "TODO");
    if (next) return this.dispatch(next);
    if (list.length === 0) return;

    // 모두 완료 → 다음 턴에 최종 통합 (LLM 호출은 한 턴에 하나)
    const [pending] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.missionId, m.id), eq(messages.receiverAgentId, this.leader.id), isNull(messages.readAt), eq(messages.type, "DIRECTIVE")));
    if (pending) return;
    const payload: MissionMessagePayload = { kind: "FINALIZE" };
    await this.db.insert(messages).values({
      orgId: m.orgId,
      missionId: m.id,
      senderType: "AGENT",
      senderAgentId: this.leader.id,
      receiverAgentId: this.leader.id,
      type: "DIRECTIVE",
      content: "모든 Task가 끝났습니다. 최종 결과를 통합합니다.",
      payload,
      priority: TASK_PRIORITY,
    });
  }

  /** Task를 담당에게 지시한다. 앞 Task 결과·사용자 추가 지시·피드백을 함께 넘긴다 */
  private async dispatch(task: Task, feedback?: string) {
    const team = await this.team();
    let assignee = team.find((a) => a.id === task.assigneeId);
    if (!assignee) assignee = pickAssignee(team, null, (task.requiredSkills ?? []) as string[], new Map()); // 담당이 해고·삭제됨 → 다시 배정

    const content = await this.taskDirective(task, feedback);
    const payload: MissionMessagePayload = { kind: "TASK" };
    await this.db.transaction(async (tx) => {
      await tx.insert(messages).values({
        orgId: this.mission.orgId,
        missionId: this.mission.id,
        taskId: task.id,
        senderType: "AGENT",
        senderAgentId: this.leader.id,
        receiverAgentId: assignee.id,
        type: "DIRECTIVE",
        content,
        payload,
        priority: TASK_PRIORITY,
      });
      await tx.update(tasks).set({ status: "DOING", assigneeId: assignee.id }).where(eq(tasks.id, task.id));
      await writeAudit(tx, {
        orgId: this.mission.orgId,
        actorType: "AGENT",
        actorId: this.leader.id,
        action: "task.dispatch",
        targetType: "task",
        targetId: task.id,
        reasoning: `"${task.title}" → ${assignee.name}${feedback ? ` (다시: ${preview(feedback)})` : ""}`,
      });
    });
    if (assignee.id !== this.leader.id) await this.deps.enqueue({ orgId: this.mission.orgId, agentId: assignee.id });
    await this.changed();
  }

  // ── 5. 보고 검토: 실패면 재시도(3회면 사용자에게 질문), 결과면 LLM 검토 → 반려(최대 1회) 또는 통과 ─────

  async review(msg: Message) {
    const [task] = msg.taskId ? await this.db.select().from(tasks).where(eq(tasks.id, msg.taskId)) : [];
    const p = (msg.payload ?? {}) as { failed?: boolean; retryLater?: boolean };
    if (!task || task.status === "DONE" || task.status === "TODO" || p.retryLater) {
      // 사용자가 옮긴 Task이거나, 담당이 예산·긴급 정지로 멈춰 나중에 이어서 할 보고
      await markRead(this.db, msg);
      return;
    }

    if (p.failed) {
      const failCount = task.failCount + 1;
      await this.db.update(tasks).set({ failCount }).where(eq(tasks.id, task.id));
      await markRead(this.db, msg);
      if (failCount >= MAX_FAILS) {
        await this.requestApproval(
          "QUESTION",
          undefined,
          `"${task.title}" Task가 ${failCount}번 실패했습니다.\n마지막 오류: ${msg.content}\n\n승인 = 다시 시도 / 거절 = 이 Task를 건너뛰고 진행`,
          { reason: "TASK_FAILED" },
          task.id,
        );
        return;
      }
      return this.dispatch(task, `이전 시도가 실패했습니다 (${failCount}/${MAX_FAILS}): ${msg.content}`);
    }

    const result = await this.taskResult(task);
    const prompt = [
      this.brief(),
      `# 검토할 Task\n${task.title}\n${task.description ?? ""}`,
      `# 담당의 결과\n${clip(result.text, 12000)}`,
      "Task 설명과 미션의 성공 기준에 비추어 이 결과를 다음 단계로 넘겨도 되는지 검토하라. 사소한 흠은 통과시키고, 빠진 내용·틀린 사실처럼 고쳐야 할 것만 반려한다.",
      '다른 말 없이 JSON만 답한다: {"pass": true 또는 false, "feedback": "반려면 구체적 수정 요청, 통과면 한 줄 평"}',
    ].join("\n\n");
    const r = await this.ask(`"${preview(task.title)}" 보고 검토`, prompt, 1500);
    const verdict = parseJsonObject<ReviewJson>(r.text);
    const feedback = (verdict?.feedback ?? "").trim() || (verdict ? "" : "(검토 결과를 읽지 못해 통과로 처리)");
    const pass = verdict?.pass !== false;

    if (!pass && task.rejectCount < MAX_REJECTS) {
      await this.db.transaction(async (tx) => {
        await tx.update(tasks).set({ rejectCount: task.rejectCount + 1 }).where(eq(tasks.id, task.id));
        await this.note(tx, task, `반려: ${feedback}`, { costKrw: r.costKrw, model: r.model });
        await tx.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msg.id));
        await writeAudit(tx, {
          orgId: this.mission.orgId,
          actorType: "AGENT",
          actorId: this.leader.id,
          action: "task.reject",
          targetType: "task",
          targetId: task.id,
          reasoning: feedback,
        });
      });
      return this.dispatch(task, `리더 검토에서 반려되었습니다. 아래를 고쳐 다시 제출하세요.\n${feedback}`);
    }

    const forced = !pass ? ` (반려 한도 ${MAX_REJECTS}회를 넘어 통과 처리)` : "";
    const checkpoint = needsCheckpoint(this.autonomy, "TASK");
    await this.db.transaction(async (tx) => {
      await this.note(tx, task, `검토 통과${forced}: ${feedback || "좋습니다"}`, { costKrw: r.costKrw, model: r.model });
      if (!checkpoint) await tx.update(tasks).set({ status: "DONE" }).where(eq(tasks.id, task.id));
      await tx.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msg.id));
      await writeAudit(tx, {
        orgId: this.mission.orgId,
        actorType: "AGENT",
        actorId: this.leader.id,
        action: "task.review_pass",
        targetType: "task",
        targetId: task.id,
        reasoning: `${feedback}${forced}`,
      });
    });
    if (checkpoint) {
      await this.requestApproval("CHECKPOINT", "TASK", `Task 결과 승인 요청 — "${task.title}"`, { artifactId: result.artifactId }, task.id);
    } else {
      await this.changed();
      await this.advance();
    }
  }

  // ── 6. 최종 통합 → (체크포인트면 승인 요청) → 사용자에게 보고 ─────────────────────

  async finalize(msg: Message, comment?: string | null) {
    const list = await this.tasks();
    const parts: string[] = [];
    for (const [i, t] of list.entries()) {
      const r = await this.taskResult(t);
      parts.push(`## ${i + 1}. ${t.title}\n${clip(r.text, 6000)}`);
    }
    const previous = comment ? await this.finalArtifact() : undefined;
    const prompt = [
      this.brief(),
      `# 팀원 결과\n${parts.join("\n\n")}`,
      `위 결과를 통합해 최종 ${this.mission.outputFormat ?? "보고서"}를 한국어 마크다운으로 작성하라. 첫 줄은 '# 제목'.`,
      "팀원 결과에 있는 출처(URL)는 유지한다. 맨 끝에 '## 성공 기준 점검'으로 기준마다 충족 여부를 체크리스트로 적는다.",
      previous ? `# 이전 최종 결과\n${clip(previous.content, 12000)}\n\n사용자 수정 요청: ${comment}\n위 요청을 반영해 다시 작성하라.` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const r = await this.ask(comment ? "최종 결과 수정" : "최종 결과 통합", prompt, 16000);
    const text = r.text || "(빈 응답)";
    const title = titleOf(text);
    const canSave = Boolean(((this.leader.toolPermissions ?? {}) as ToolPermissions).document);
    const checkpoint = needsCheckpoint(this.autonomy, "FINAL");

    const artifactId = await this.db.transaction(async (tx) => {
      let id: string | null = null;
      if (canSave) {
        const [art] = await tx
          .insert(artifacts)
          .values({
            orgId: this.mission.orgId,
            missionId: this.mission.id,
            agentId: this.leader.id,
            title,
            format: "markdown",
            content: text,
            version: previous ? previous.version + 1 : 1,
            parentVersionId: previous?.id ?? null,
          })
          .returning({ id: artifacts.id });
        id = art.id;
      }
      if (checkpoint) await tx.update(missions).set({ status: "REVIEW" }).where(eq(missions.id, this.mission.id));
      await tx.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msg.id));
      await writeAudit(tx, {
        orgId: this.mission.orgId,
        actorType: "AGENT",
        actorId: this.leader.id,
        action: "mission.finalize",
        targetType: "mission",
        targetId: this.mission.id,
        reasoning: `최종 결과 "${title}" (${r.model}, ${r.costKrw.toFixed(2)}원)${comment ? ` — 사용자 수정 요청 반영: ${preview(comment)}` : ""}`,
        payload: { artifactId: id },
      });
      return id;
    });

    if (checkpoint) {
      const body = artifactId ? `최종 결과 승인 요청 — "${title}"` : `최종 결과 승인 요청 — "${title}"\n\n${text}`;
      await this.requestApproval("CHECKPOINT", "FINAL", body, { artifactId });
    } else {
      await this.complete(artifactId, title, text, r);
    }
  }

  private async complete(artifactId: string | null, title: string, text: string, r?: { costKrw: number; model: string }) {
    await this.db.transaction(async (tx) => {
      await tx.update(missions).set({ status: "DONE" }).where(eq(missions.id, this.mission.id));
      await writeAudit(tx, {
        orgId: this.mission.orgId,
        actorType: "AGENT",
        actorId: this.leader.id,
        action: "mission.complete",
        targetType: "mission",
        targetId: this.mission.id,
        reasoning: `미션 완료 — 최종 결과 "${title}"`,
      });
    });
    await this.tellUser(artifactId ? `미션을 마쳤습니다. 최종 결과 "${title}"을(를) 만들었습니다.` : `미션을 마쳤습니다.\n\n${text}`, {
      artifactId,
      ...(r ? { costKrw: Number(r.costKrw.toFixed(4)), model: r.model } : {}),
    });
  }

  // ── 사용자 결정 반영 (승인함 F012 → 메시지로 전달) ─────────────────────────────

  async applyApproval(msg: Message) {
    const approvalId = (msg.payload as MissionMessagePayload).approvalId;
    const [ap] = approvalId ? await this.db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId)) : [];
    if (!ap || (ap.status !== "APPROVED" && ap.status !== "REJECTED")) {
      await markRead(this.db, msg);
      return;
    }
    const approved = ap.status === "APPROVED";
    const p = (ap.payload ?? {}) as ApprovalPayload;
    const [task] = ap.taskId ? await this.db.select().from(tasks).where(eq(tasks.id, ap.taskId)) : [];
    const comment = ap.userComment?.trim() || null;

    if (ap.type === "CHECKPOINT" && p.stage === "PLAN") {
      if (!approved) return this.plan(msg, comment ?? "다른 방식으로 다시 세워 주세요");
      await markRead(this.db, msg);
      return this.advance();
    }
    if (ap.type === "CHECKPOINT" && p.stage === "TASK" && task) {
      await markRead(this.db, msg);
      if (!approved) return this.dispatch(task, `사용자가 결과를 거절했습니다. 아래를 반영해 다시 제출하세요.\n${comment ?? "더 나은 결과를 원합니다"}`);
      await this.db.update(tasks).set({ status: "DONE" }).where(eq(tasks.id, task.id));
      await this.changed();
      return this.advance();
    }
    if (ap.type === "CHECKPOINT" && p.stage === "FINAL") {
      if (!approved) {
        await this.db.update(missions).set({ status: "RUNNING" }).where(eq(missions.id, this.mission.id));
        return this.finalize(msg, comment ?? "더 나은 결과를 원합니다");
      }
      await markRead(this.db, msg);
      const final = await this.finalArtifact();
      return this.complete(final?.id ?? null, final?.title ?? this.mission.title, final?.content ?? ap.content);
    }
    if (ap.type === "QUESTION" && p.reason === "TASK_FAILED" && task) {
      await markRead(this.db, msg);
      if (approved) {
        await this.db.update(tasks).set({ failCount: 0 }).where(eq(tasks.id, task.id));
        return this.dispatch(task, comment ? `사용자 안내: ${comment}` : undefined);
      }
      await this.db.update(tasks).set({ status: "DONE" }).where(eq(tasks.id, task.id));
      await this.db.transaction((tx) => this.note(tx, task, "사용자 결정으로 이 Task를 건너뜁니다."));
      await this.changed();
      return this.advance();
    }
    if (ap.type === "QUESTION" && p.retryMessageId) {
      // 리더가 처리하다 실패한 메시지를 다시 읽지 않은 상태로 돌려 다음 턴에 재시도
      if (approved) await this.db.update(messages).set({ readAt: null }).where(eq(messages.id, p.retryMessageId));
      await markRead(this.db, msg);
      return;
    }
    await markRead(this.db, msg);
  }

  /** 사용자가 미션 대화에 끼어든 메시지에 짧게 답한다. 이 메시지는 이후 Task 지시에 '사용자 추가 지시'로 함께 간다 */
  async replyToNote(msg: Message) {
    const list = await this.tasks();
    const status = list.map((t, i) => `${i + 1}. [${t.status}] ${t.title}`).join("\n") || "(아직 Task 없음)";
    const prompt = [
      this.brief(),
      `# 진행 상황\n${status}`,
      `# 사용자 메시지\n${msg.content}`,
      "리더로서 3~5문장으로 답하라. 앞으로의 진행에 어떻게 반영할지 말한다 (이 메시지는 이후 팀원 지시에 함께 전달된다).",
    ].join("\n\n");
    const r = await this.ask("사용자 메시지 답변", prompt, 1500);
    await markRead(this.db, msg);
    await this.tellUser(r.text || "확인했습니다.", { costKrw: Number(r.costKrw.toFixed(4)), model: r.model });
  }

  /** 리더가 처리하다 실패하면 사용자에게 다시 시도할지 묻는다 (미션이 조용히 멈추지 않게) */
  async askRetry(msg: Message, error: string) {
    const kind = missionKind(msg.payload) ?? "REPORT";
    await markRead(this.db, msg);
    await this.requestApproval(
      "QUESTION",
      undefined,
      `리더 ${this.leader.name}이(가) "${KIND_LABEL[kind]}"에 실패했습니다: ${error}\n\n승인 = 다시 시도 / 거절 = 그대로 두기 (미션을 취소하려면 미션 화면에서)`,
      { reason: "LEADER_FAILED", retryMessageId: msg.id },
      msg.taskId,
    );
  }

  // ── 도움 함수 ─────────────────────────────────────────────

  private async ask(purpose: string, prompt: string, maxTokens: number) {
    const perms = (this.leader.toolPermissions ?? {}) as ToolPermissions;
    const skills = (this.leader.skills ?? []) as string[];
    return callLLM(
      this.db,
      {
        orgId: this.mission.orgId,
        agentId: this.leader.id,
        missionId: this.mission.id,
        actor: { type: "AGENT", id: this.leader.id },
        purpose: `미션 "${preview(this.mission.title)}": ${purpose}`,
        model: this.leader.modelPrimary ?? DEFAULT_MODELS.primary,
        economyModel: this.leader.modelEconomy ?? DEFAULT_MODELS.economy,
        system: buildSystemPrompt({
          name: this.leader.name,
          role: `리더${skills.length ? ` (${skills.join(", ")})` : ""}`,
          personality: this.leader.personality,
          skills,
          instructions: [
            "- 미션을 Task로 나누고, 팀원의 결과를 검토하고, 최종 결과로 통합한다.",
            "- 요청한 답 형식(JSON 또는 마크다운)을 정확히 지킨다. 모르는 것은 지어내지 않는다.",
            perms.web_search ? "" : "- 리더는 웹 검색을 하지 않는다. 최신 정보는 팀원 결과에 의존한다.",
          ]
            .filter(Boolean)
            .join("\n"),
        }),
        messages: [{ role: "user", content: prompt }],
        maxTokens,
      },
      this.deps.provider,
    );
  }

  private brief(): string {
    const m = this.mission;
    const criteria = ((m.successCriteria ?? []) as string[]).map((c) => `- ${c}`).join("\n");
    return [
      `# 미션: ${m.title}`,
      `주제: ${m.topic}`,
      m.goal ? `목표: ${m.goal}` : "",
      criteria ? `성공 기준:\n${criteria}` : "",
      `산출물 형식: ${m.outputFormat ?? "보고서"}`,
      m.deadline ? `마감: ${m.deadline.toISOString().slice(0, 10)}` : "",
      m.referenceNotes ? `참고 자료:\n${clip(m.referenceNotes, 4000)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async taskDirective(task: Task, feedback?: string): Promise<string> {
    const list = await this.tasks();
    const before = list.filter((t) => t.order < task.order && t.status === "DONE");
    const prev: string[] = [];
    let budget = 16000;
    for (const t of before.reverse()) {
      if (budget <= 0) break;
      const r = await this.taskResult(t);
      const text = clip(r.text, Math.min(6000, budget));
      budget -= text.length;
      prev.unshift(`## ${t.title}\n${text}`);
    }
    const notes = await this.db
      .select({ content: messages.content, payload: messages.payload })
      .from(messages)
      .where(and(eq(messages.missionId, this.mission.id), eq(messages.senderType, "USER")))
      .orderBy(asc(messages.createdAt));
    const userNotes = notes.filter((n) => missionKind(n.payload) === "NOTE").slice(-10);

    return [
      this.brief(),
      `# 내 Task (${list.findIndex((t) => t.id === task.id) + 1}/${list.length}): ${task.title}\n${task.description ?? ""}`,
      prev.length ? `# 앞 Task 결과 (참고해서 이어 작업)\n${prev.join("\n\n")}` : "",
      userNotes.length ? `# 사용자 추가 지시 (최우선)\n${userNotes.map((n) => `- ${n.content}`).join("\n")}` : "",
      feedback ? `# 다시 할 때 반영할 것\n${feedback}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /** Task 결과: 가장 최근 산출물, 없으면 가장 최근 성공 보고 내용 */
  private async taskResult(task: Task): Promise<{ text: string; artifactId: string | null }> {
    const [art] = await this.db.select().from(artifacts).where(eq(artifacts.taskId, task.id)).orderBy(desc(artifacts.version)).limit(1);
    if (art) return { text: art.content, artifactId: art.id };
    const reports = await this.db
      .select({ content: messages.content, payload: messages.payload })
      .from(messages)
      .where(and(eq(messages.taskId, task.id), eq(messages.type, "REPORT"), ne(messages.senderAgentId, this.leader.id)))
      .orderBy(desc(messages.createdAt));
    const ok = reports.find((r) => !(r.payload as { failed?: boolean } | null)?.failed);
    return { text: ok?.content ?? "(결과 없음)", artifactId: null };
  }

  private async finalArtifact() {
    const [art] = await this.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.missionId, this.mission.id), isNull(artifacts.taskId)))
      .orderBy(desc(artifacts.version))
      .limit(1);
    return art;
  }

  private tasks() {
    return this.db.select().from(tasks).where(eq(tasks.missionId, this.mission.id)).orderBy(asc(tasks.order), asc(tasks.createdAt));
  }

  /** 담당 후보: 리더를 뺀 활성 에이전트. 아무도 없으면 리더가 직접 한다 */
  private async team(): Promise<Agent[]> {
    const all = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.orgId, this.mission.orgId), eq(agents.isActive, true)))
      .orderBy(asc(agents.createdAt));
    const members = all.filter((a) => a.id !== this.leader.id);
    return members.length ? members : [this.leader];
  }

  /** 미션 대화에 남기는 리더의 말 (담당에게 보내지만 처리할 일은 아니므로 읽음으로 저장) */
  private async note(tx: Db, task: Task, content: string, extra: Record<string, unknown> = {}) {
    await tx.insert(messages).values({
      orgId: this.mission.orgId,
      missionId: this.mission.id,
      taskId: task.id,
      senderType: "AGENT",
      senderAgentId: this.leader.id,
      receiverAgentId: task.assigneeId,
      type: "REPORT",
      content,
      payload: extra,
      readAt: new Date(),
    });
  }

  /** 사용자에게 보고 (미션 대화에 표시) */
  async tellUser(content: string, payload: Record<string, unknown> = {}) {
    await this.db.transaction(async (tx) => {
      const [m] = await tx
        .insert(messages)
        .values({
          orgId: this.mission.orgId,
          missionId: this.mission.id,
          senderType: "AGENT",
          senderAgentId: this.leader.id,
          type: "REPORT",
          content,
          payload,
        })
        .returning({ id: messages.id });
      await writeAudit(tx, {
        orgId: this.mission.orgId,
        actorType: "AGENT",
        actorId: this.leader.id,
        action: "message.report",
        targetType: "message",
        targetId: m.id,
        reasoning: preview(content),
      });
    });
    await this.deps.publish(this.mission.orgId, { type: "message", agentId: this.leader.id });
    await this.changed();
  }

  private async requestApproval(type: "CHECKPOINT" | "QUESTION", stage: CheckpointStage | undefined, content: string, extra: ApprovalPayload = {}, taskId?: string | null) {
    await this.db.transaction(async (tx) => {
      const [req] = await tx
        .insert(approvalRequests)
        .values({
          orgId: this.mission.orgId,
          agentId: this.leader.id,
          missionId: this.mission.id,
          taskId: taskId ?? null,
          type,
          content,
          payload: { ...extra, ...(stage ? { stage } : {}) },
        })
        .returning({ id: approvalRequests.id });
      await writeAudit(tx, {
        orgId: this.mission.orgId,
        actorType: "AGENT",
        actorId: this.leader.id,
        action: "approval.request",
        targetType: "approval_request",
        targetId: req.id,
        reasoning: preview(content),
        payload: { type, stage: stage ?? null },
      });
    });
    await this.deps.publish(this.mission.orgId, { type: "approval" });
    await this.changed();
  }

  private async changed() {
    await this.deps.publish(this.mission.orgId, { type: "mission", missionId: this.mission.id });
  }
}

async function markRead(db: Db, msg: Message) {
  await db.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msg.id));
}

/**
 * 담당 고르기 (PRD F007 3단계: 특기 일치도 + 현재 부하).
 * 리더가 이름을 정했고 그 사람이 팀에 있으면 그대로, 아니면 특기가 많이 겹치는 사람 → 맡은 일이 적은 사람.
 */
export function pickAssignee(team: Agent[], name: string | null | undefined, skills: string[], load: Map<string, number>): Agent {
  const named = name ? team.find((a) => a.name === name.trim()) : undefined;
  if (named) return named;
  const score = (a: Agent) => {
    const mine = ((a.skills ?? []) as string[]).map((s) => s.toLowerCase());
    return skills.filter((s) => mine.some((m) => m.includes(s.toLowerCase()) || s.toLowerCase().includes(m))).length;
  };
  return [...team].sort((a, b) => score(b) - score(a) || (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
}

/** LLM 답에서 JSON 객체를 꺼낸다 (```json 블록이나 앞뒤 설명이 붙어도). 못 읽으면 null */
export function parseJsonObject<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
