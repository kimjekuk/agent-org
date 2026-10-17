import { getDb, schema } from "@agentorg/shared/db";
import type { ApprovalPayload } from "@agentorg/shared/missions";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approvalBadge, decisionLabels, waitingFor } from "@/lib/approvals";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { card } from "@/lib/ui";
import { DecisionForm } from "../forms";

export const dynamic = "force-dynamic";

const timeFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" });

// F012 승인 요청 상세: 전체 내용 + 관련 미션·Task·산출물 + 승인/거절/보류 + 코멘트
export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const [req] = await db
    .select()
    .from(schema.approvalRequests)
    .where(and(eq(schema.approvalRequests.id, id), eq(schema.approvalRequests.orgId, org.id)));
  if (!req) notFound();

  const p = (req.payload ?? {}) as ApprovalPayload;
  const [[agent], [mission], [task], [artifact]] = await Promise.all([
    req.agentId ? db.select().from(schema.agents).where(eq(schema.agents.id, req.agentId)) : [],
    req.missionId ? db.select().from(schema.missions).where(eq(schema.missions.id, req.missionId)) : [],
    req.taskId ? db.select().from(schema.tasks).where(eq(schema.tasks.id, req.taskId)) : [],
    p.artifactId ? db.select().from(schema.artifacts).where(eq(schema.artifacts.id, p.artifactId)) : [],
  ]);
  // 계획 승인이면 계획(Task 목록)을 함께 보여 준다
  const plan =
    req.type === "CHECKPOINT" && p.stage === "PLAN" && req.missionId
      ? await db
          .select({ title: schema.tasks.title, description: schema.tasks.description, assignee: schema.agents.name })
          .from(schema.tasks)
          .leftJoin(schema.agents, eq(schema.agents.id, schema.tasks.assigneeId))
          .where(eq(schema.tasks.missionId, req.missionId))
          .orderBy(asc(schema.tasks.order))
      : [];
  const badge = approvalBadge(req);
  const labels = decisionLabels(req);
  const open = req.status === "PENDING" || req.status === "HELD";

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <Link href="/approvals" className="text-sm opacity-70">
        ← 승인 대기함
      </Link>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${badge.className}`}>{badge.label}</span>
        <span className="opacity-70">
          {agent?.name ?? "시스템"} · {timeFmt.format(req.createdAt)} · {open ? waitingFor(req.createdAt) : req.status === "APPROVED" ? "승인됨" : "거절됨"}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words font-semibold">{req.content}</p>

      {(mission || task) && (
        <div className="flex flex-col gap-1 text-sm">
          {mission && (
            <Link href={`/missions/${mission.id}`} className="underline">
              미션: {mission.title}
            </Link>
          )}
          {task && <p>Task: {task.title}</p>}
        </div>
      )}

      {plan.length > 0 && (
        <section className={card}>
          <h2 className="mb-2 font-semibold">계획</h2>
          <ol className="flex flex-col gap-2 text-sm">
            {plan.map((t, i) => (
              <li key={`${i}-${t.title}`}>
                <b>
                  {i + 1}. {t.title}
                </b>{" "}
                <span className="opacity-70">— {t.assignee ?? "담당 없음"}</span>
                {t.description && <p className="opacity-80">{t.description}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {artifact && (
        <details className={card} open>
          <summary className="cursor-pointer font-semibold">
            📄 {artifact.title}
            {artifact.version > 1 ? ` (v${artifact.version})` : ""}
          </summary>
          <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{artifact.content}</div>
        </details>
      )}

      {open ? (
        <section className={`${card} flex flex-col gap-3`}>
          {labels.help && <p className="text-sm opacity-80">{labels.help}</p>}
          <DecisionForm id={req.id} approveLabel={labels.approve} rejectLabel={labels.reject} />
        </section>
      ) : (
        <p className="text-sm opacity-80">
          {req.decidedAt ? `${timeFmt.format(req.decidedAt)}에 ` : ""}
          {req.status === "APPROVED" ? "승인" : "거절"}했습니다{req.userComment ? ` — ${req.userComment}` : ""}
        </p>
      )}
    </main>
  );
}
