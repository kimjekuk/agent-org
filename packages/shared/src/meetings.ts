// F104 회의 (2026-10-19 결정)
// - 킥오프(계획 직후)·회고(미션 완료 후) 둘 다. 미션마다 끌 수 있다
// - 진행: 참여자(Task 담당, 리더 제외)가 순서대로 한 번씩 의견 → 리더가 결론. 참여자당 AI 호출 1번 + 결론 1번
// - 킥오프 결론은 이후 Task 지시에 함께 가고, 회고 결론의 교훈은 참여자 모두의 장기 기억이 된다
// - 사용자는 회의록에 답글을 달 수 있다. 진행 중이면 다음 발언자·결론에 반영, 끝난 회의면 리더가 결론을 다시 정리한다
import { and, eq, isNull, sql } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { AnyDb } from "./db/client";
import { meetings, meetingTurns, messages, missions } from "./db/schema";
import type { MissionMessagePayload } from "./missions";
import type { RunAgentJob } from "./queue";

export type MeetingKind = "KICKOFF" | "RETRO";

export const MEETING_LABEL: Record<MeetingKind, string> = { KICKOFF: "킥오프 회의", RETRO: "회고 회의" };

/** 회의 결론 끝에 두는 교훈 제목 (회고 결론에서 떼어 장기 기억으로 저장) */
export const RETRO_LESSON_HEADING = "다음에 기억할 점";

const MAX_REPLY = 2000;

/**
 * 사용자 답글을 회의록에 남긴다. 끝난 회의면 리더에게 결론을 다시 정리하라고 보낸다 (이미 보낸 게 남아 있으면 또 보내지 않음).
 * 큐에 넣을 작업이 있으면 돌려준다.
 */
export async function addUserReply(
  db: AnyDb,
  input: { orgId: string; userId: string; meetingId: string; content: string },
): Promise<RunAgentJob | null> {
  const content = input.content.trim().slice(0, MAX_REPLY);
  if (!content) throw new Error("내용을 입력해 주세요");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ meeting: meetings, leaderId: missions.leaderId, missionStatus: missions.status })
      .from(meetings)
      .innerJoin(missions, eq(missions.id, meetings.missionId))
      .where(and(eq(meetings.id, input.meetingId), eq(meetings.orgId, input.orgId)));
    if (!row) throw new Error("회의를 찾을 수 없습니다");
    const { meeting } = row;
    const [turn] = await tx
      .insert(meetingTurns)
      .values({ meetingId: meeting.id, speakerType: "USER", content })
      .returning({ id: meetingTurns.id });
    await writeAudit(tx, {
      orgId: input.orgId,
      actorType: "USER",
      actorId: input.userId,
      action: "meeting.reply",
      targetType: "meeting",
      targetId: meeting.id,
      reasoning: content.length > 60 ? `${content.slice(0, 60)}…` : content,
      payload: { turnId: turn.id },
    });

    // 진행 중인 회의는 다음 발언자와 리더 결론이 답글을 함께 본다
    if (meeting.status === "RUNNING" || !row.leaderId || row.missionStatus === "CANCELLED") return null;
    const [pending] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.missionId, meeting.missionId), isNull(messages.readAt), sql`${messages.payload}->>'kind' = 'MEETING_WRAP'`, sql`${messages.payload}->>'meetingId' = ${meeting.id}`))
      .limit(1);
    if (pending) return null;
    const payload: MissionMessagePayload = { kind: "MEETING_WRAP", meetingId: meeting.id };
    await tx.insert(messages).values({
      orgId: input.orgId,
      missionId: meeting.missionId,
      senderType: "USER",
      receiverAgentId: row.leaderId,
      type: "DIRECTIVE",
      content: `${MEETING_LABEL[meeting.kind]}에 사용자 답글이 달렸습니다. 결론을 다시 정리해 주세요.`,
      payload,
      priority: 50,
    });
    return { orgId: input.orgId, agentId: row.leaderId };
  });
}
