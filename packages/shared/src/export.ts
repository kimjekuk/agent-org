// F205 외부 연동 (2026-10-21 결정): 미션 최종 결과를 이메일·슬랙으로 보낸다.
// 결과 화면의 '보내기' → 승인함에 EXTERNAL 요청 → 사용자가 승인하면 그때 발송 (CLAUDE.md 절대 규칙 3).
// 연결 정보(SMTP 비밀번호·웹훅 주소)는 ENCRYPTION_KEY로 암호화해 저장하고 화면에는 가린 요약만 보여 준다.
import { and, eq, inArray } from "drizzle-orm";
import { requireExternalApproval } from "./approval";
import { writeAudit } from "./audit";
import { type EmailConfig, postSlack, type SlackConfig, sendEmail } from "./channels";
import { decryptSecret, encryptSecret } from "./crypto";
import type { AnyDb } from "./db/client";
import { approvalRequests, artifacts, exportChannels, missions } from "./db/schema";

export const EXPORT_KIND = "EXPORT";
export const EXPORT_CHANNELS = ["EMAIL", "SLACK"] as const;
export type ExportChannel = (typeof EXPORT_CHANNELS)[number];
export const CHANNEL_LABEL: Record<ExportChannel, string> = { EMAIL: "이메일", SLACK: "슬랙" };

export type { EmailConfig, SlackConfig };

/** 승인 요청 payload: 무엇을 어디로 보낼지 + 발송 결과 */
export interface ExportPayload {
  kind: typeof EXPORT_KIND;
  channel: ExportChannel;
  artifactId: string;
  to?: string[];
  sentAt?: string;
  error?: string;
}

export function isExportPayload(p: unknown): p is ExportPayload {
  return (p as ExportPayload | null)?.kind === EXPORT_KIND;
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const SLACK_RE = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/;

/** 쉼표·줄바꿈으로 나눈 이메일 주소 (최대 10개). 형식이 틀린 것이 있으면 null */
export function parseRecipients(text: string): string[] | null {
  const list = [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
  if (list.length === 0 || list.length > 10 || !list.every((e) => EMAIL_RE.test(e))) return null;
  return list;
}

/** 입력값 확인 + 화면에 보여 줄 가린 요약. 틀리면 error */
export function validateChannel(kind: ExportChannel, raw: Record<string, string>): { config: EmailConfig | SlackConfig; label: string } | { error: string } {
  if (kind === "SLACK") {
    const webhookUrl = (raw.webhookUrl ?? "").trim();
    if (!SLACK_RE.test(webhookUrl)) return { error: "슬랙 웹훅 주소는 https://hooks.slack.com/services/… 형식이어야 합니다" };
    return { config: { webhookUrl }, label: `hooks.slack.com/…${webhookUrl.slice(-4)}` };
  }
  const host = (raw.host ?? "").trim();
  const port = Number(raw.port || 587);
  const user = (raw.user ?? "").trim();
  const pass = (raw.pass ?? "").replace(/\s/g, ""); // 앱 비밀번호는 띄어쓰기를 넣어 보여 주는 곳이 많다
  const from = (raw.from ?? "").trim() || user;
  const to = parseRecipients(raw.to ?? "");
  if (!/^[a-z0-9.-]+$/i.test(host)) return { error: "SMTP 서버 주소를 확인해 주세요 (예: smtp.gmail.com)" };
  if (![25, 465, 587, 2525].includes(port)) return { error: "포트는 587(보통) 또는 465를 써 주세요" };
  if (!user || !pass) return { error: "SMTP 아이디와 비밀번호(앱 비밀번호)를 넣어 주세요" };
  if (!EMAIL_RE.test(from)) return { error: "보내는 사람 이메일 주소를 확인해 주세요" };
  if (!to) return { error: "받는 사람 이메일 주소를 확인해 주세요 (쉼표로 여러 명, 최대 10명)" };
  return { config: { host, port, user, pass, from, to }, label: `${from} → ${to.join(", ")}` };
}

export async function saveExportChannel(db: AnyDb, input: { orgId: string; userId: string; kind: ExportChannel; raw: Record<string, string> }): Promise<{ error: string } | { ok: true }> {
  const v = validateChannel(input.kind, input.raw);
  if ("error" in v) return v;
  const encryptedConfig = encryptSecret(JSON.stringify(v.config));
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(exportChannels)
      .values({ orgId: input.orgId, kind: input.kind, encryptedConfig, label: v.label })
      .onConflictDoUpdate({ target: [exportChannels.orgId, exportChannels.kind], set: { encryptedConfig, label: v.label, createdAt: new Date() } })
      .returning({ id: exportChannels.id });
    await writeAudit(tx, {
      orgId: input.orgId,
      actorType: "USER",
      actorId: input.userId,
      action: "export.channel_save",
      targetType: "export_channel",
      targetId: row.id,
      reasoning: `${CHANNEL_LABEL[input.kind]} 연결 저장`,
      payload: { kind: input.kind, label: v.label }, // 비밀번호·웹훅 주소는 기록하지 않는다
    });
  });
  return { ok: true };
}

export async function deleteExportChannel(db: AnyDb, input: { orgId: string; userId: string; kind: ExportChannel }) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(exportChannels)
      .where(and(eq(exportChannels.orgId, input.orgId), eq(exportChannels.kind, input.kind)))
      .returning({ id: exportChannels.id });
    if (!row) return;
    await writeAudit(tx, {
      orgId: input.orgId,
      actorType: "USER",
      actorId: input.userId,
      action: "export.channel_delete",
      targetType: "export_channel",
      targetId: row.id,
      reasoning: `${CHANNEL_LABEL[input.kind]} 연결 삭제`,
    });
  });
}

/** 화면용: 연결된 종류와 가린 요약, 이메일 기본 받는 사람 */
export async function listExportChannels(db: AnyDb, orgId: string): Promise<{ kind: ExportChannel; label: string; defaultTo?: string }[]> {
  const rows = await db.select().from(exportChannels).where(eq(exportChannels.orgId, orgId));
  return rows
    .filter((r): r is typeof r & { kind: ExportChannel } => (EXPORT_CHANNELS as readonly string[]).includes(r.kind))
    .map((r) => {
      let defaultTo: string | undefined;
      if (r.kind === "EMAIL") {
        try {
          defaultTo = (JSON.parse(decryptSecret(r.encryptedConfig)) as EmailConfig).to.join(", ");
        } catch {
          defaultTo = undefined;
        }
      }
      return { kind: r.kind, label: r.label, defaultTo };
    })
    .sort((a, b) => EXPORT_CHANNELS.indexOf(a.kind) - EXPORT_CHANNELS.indexOf(b.kind));
}

/** 미션 최종 결과(미션에 속하고 Task가 없는 산출물)인지 */
export function isFinalResult(a: { missionId: string | null; taskId: string | null }): boolean {
  return Boolean(a.missionId) && !a.taskId;
}

/** '보내기': 승인함에 외부 발송 요청을 올린다 (아직 보내지 않음). 같은 결과·같은 곳으로 대기 중인 요청이 있으면 그것을 돌려준다 */
export async function requestExport(
  db: AnyDb,
  input: { orgId: string; userId: string; artifactId: string; channel: ExportChannel; to?: string | null },
): Promise<{ error: string } | { approvalId: string; existing: boolean }> {
  const [art] = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.id, input.artifactId), eq(artifacts.orgId, input.orgId)));
  if (!art) return { error: "산출물을 찾을 수 없습니다" };
  if (!isFinalResult(art)) return { error: "미션 최종 결과만 보낼 수 있습니다" };
  const [ch] = await db
    .select()
    .from(exportChannels)
    .where(and(eq(exportChannels.orgId, input.orgId), eq(exportChannels.kind, input.channel)));
  if (!ch) return { error: `${CHANNEL_LABEL[input.channel]} 연결이 없습니다. 설정 → 내보내기 연결에서 먼저 등록해 주세요` };
  let to: string[] | undefined;
  if (input.channel === "EMAIL") {
    const parsed = input.to?.trim() ? parseRecipients(input.to) : (JSON.parse(decryptSecret(ch.encryptedConfig)) as EmailConfig).to;
    if (!parsed) return { error: "받는 사람 이메일 주소를 확인해 주세요 (쉼표로 여러 명, 최대 10명)" };
    to = parsed;
  }

  const pending = await db
    .select({ id: approvalRequests.id, payload: approvalRequests.payload })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.orgId, input.orgId), eq(approvalRequests.type, "EXTERNAL"), inArray(approvalRequests.status, ["PENDING", "HELD"])));
  const dup = pending.find((r) => {
    const p = r.payload;
    return isExportPayload(p) && p.artifactId === art.id && p.channel === input.channel && (p.to ?? []).join() === (to ?? []).join();
  });
  if (dup) return { approvalId: dup.id, existing: true };

  const where = input.channel === "EMAIL" ? `이메일 (${to!.join(", ")})` : `슬랙 (${ch.label})`;
  const payload: ExportPayload = { kind: EXPORT_KIND, channel: input.channel, artifactId: art.id, ...(to ? { to } : {}) };
  return db.transaction(async (tx) => {
    const [req] = await tx
      .insert(approvalRequests)
      .values({
        orgId: input.orgId,
        missionId: art.missionId,
        type: "EXTERNAL",
        content: `${where}으로 보내기: "${art.title}"`,
        payload,
      })
      .returning({ id: approvalRequests.id });
    await writeAudit(tx, {
      orgId: input.orgId,
      actorType: "USER",
      actorId: input.userId,
      action: "export.request",
      targetType: "approval_request",
      targetId: req.id,
      reasoning: `"${art.title}" → ${where} 발송 승인 요청`,
      payload: { channel: input.channel, artifactId: art.id },
    });
    return { approvalId: req.id, existing: false };
  });
}

// ── 발송 ──────────────────────────────────────────────

export interface ExportMessage {
  title: string;
  /** 마크다운 본문 */
  body: string;
  missionTitle: string | null;
}

export interface ExportSenders {
  slack(config: SlackConfig, msg: ExportMessage): Promise<void>;
  email(config: EmailConfig, to: string[], msg: ExportMessage): Promise<void>;
}

const SLACK_MAX = 3800; // 슬랙 메시지 한 칸에 무리 없이 들어가는 길이

/** 마크다운 → 슬랙 mrkdwn (제목은 굵게, **굵게** → *굵게*, [글](주소) → <주소|글>) */
export function toSlackText(msg: ExportMessage): string {
  const body = msg.body
    .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<$2|$1>");
  const head = `*${msg.title}*${msg.missionTitle ? `\n미션: ${msg.missionTitle}` : ""}\n\n`;
  const room = SLACK_MAX - head.length;
  return head + (body.length > room ? `${body.slice(0, room)}\n…(이하 생략 — AgentOrg에서 전체 보기)` : body);
}

export function toEmailHtml(msg: ExportMessage): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<div style="font-family:sans-serif;line-height:1.6"><h2>${esc(msg.title)}</h2>${msg.missionTitle ? `<p style="color:#666">미션: ${esc(msg.missionTitle)}</p>` : ""}<div style="white-space:pre-wrap">${esc(msg.body)}</div><hr><p style="color:#999;font-size:12px">AgentOrg에서 보냄</p></div>`;
}

export const defaultSenders: ExportSenders = {
  slack: (config, msg) => postSlack(config, toSlackText(msg)),
  email: (config, to, msg) =>
    sendEmail(config, to, {
      subject: `[AgentOrg] ${msg.title}`,
      text: `${msg.title}\n${msg.missionTitle ? `미션: ${msg.missionTitle}\n` : ""}\n${msg.body}\n\n— AgentOrg에서 보냄`,
      html: toEmailHtml(msg),
    }),
};

/**
 * 승인된 외부 발송 요청을 실제로 보낸다. 승인되지 않았으면 ApprovalRequiredError (절대 규칙 3).
 * 이미 보냈으면 다시 보내지 않는다. 실패하면 이유를 요청에 남겨 '다시 보내기'를 할 수 있게 한다.
 */
export async function runExport(
  db: AnyDb,
  input: { orgId: string; userId: string; approvalId: string },
  senders: ExportSenders = defaultSenders,
): Promise<{ ok: true } | { error: string }> {
  await requireExternalApproval(db, input.orgId, input.approvalId);
  const [req] = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, input.approvalId), eq(approvalRequests.orgId, input.orgId)));
  const p = req?.payload;
  if (!isExportPayload(p)) return { error: "보낼 내용이 없는 요청입니다" };
  if (p.sentAt) return { error: "이미 보냈습니다" };

  let error: string | undefined;
  let where = CHANNEL_LABEL[p.channel];
  try {
    const [art] = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, p.artifactId), eq(artifacts.orgId, input.orgId)));
    if (!art) throw new Error("보낼 산출물이 지워졌습니다");
    const [ch] = await db
      .select()
      .from(exportChannels)
      .where(and(eq(exportChannels.orgId, input.orgId), eq(exportChannels.kind, p.channel)));
    if (!ch) throw new Error(`${CHANNEL_LABEL[p.channel]} 연결이 없습니다. 설정에서 다시 등록해 주세요`);
    const [mission] = art.missionId ? await db.select({ title: missions.title }).from(missions).where(eq(missions.id, art.missionId)) : [];
    const msg: ExportMessage = { title: art.title, body: art.content, missionTitle: mission?.title ?? null };
    const config = JSON.parse(decryptSecret(ch.encryptedConfig)) as EmailConfig | SlackConfig;
    if (p.channel === "SLACK") {
      await senders.slack(config as SlackConfig, msg);
      where = `슬랙 (${ch.label})`;
    } else {
      const to = p.to?.length ? p.to : (config as EmailConfig).to;
      await senders.email(config as EmailConfig, to, msg);
      where = `이메일 (${to.join(", ")})`;
    }
  } catch (e) {
    error = ((e as Error).message || "알 수 없는 오류").slice(0, 300);
  }

  const next: ExportPayload = error ? { ...p, error } : { ...p, sentAt: new Date().toISOString(), error: undefined };
  await db.transaction(async (tx) => {
    await tx.update(approvalRequests).set({ payload: next }).where(eq(approvalRequests.id, input.approvalId));
    await writeAudit(tx, {
      orgId: input.orgId,
      actorType: "USER",
      actorId: input.userId,
      action: error ? "export.fail" : "export.send",
      targetType: "approval_request",
      targetId: input.approvalId,
      reasoning: error ? `${where} 발송 실패: ${error}` : `${where}으로 보냄`,
      payload: { channel: p.channel, artifactId: p.artifactId },
    });
  });
  return error ? { error } : { ok: true };
}
