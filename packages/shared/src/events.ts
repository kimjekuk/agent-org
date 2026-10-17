// 실시간 이벤트 (PRD 5장 F007/F008 "실시간 전달"): DB에 쓴 뒤 Redis pub/sub으로 알리면
// web의 /api/events(SSE)가 브라우저로 밀어준다. 이벤트에는 무엇이 바뀌었는지만 담고, 내용은 화면이 DB에서 다시 읽는다.
import Redis from "ioredis";

export type OrgEvent =
  | { type: "message"; agentId?: string | null }
  | { type: "artifact"; agentId?: string | null }
  | { type: "agent"; agentId: string }
  | { type: "org" } // 긴급 정지·재개 등 조직 상태
  | { type: "mission"; missionId: string } // 미션·Task 상태
  | { type: "approval" } // 승인 대기함
  | { type: "audit" };

export const orgChannel = (orgId: string) => `org:${orgId}:events`;

let publisher: Redis | undefined;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 1, lazyConnect: true });
    publisher.on("error", () => {}); // 실시간 알림 실패가 작업을 막지 않게 한다
  }
  return publisher;
}

/** 실패해도 예외를 던지지 않는다 (화면 자동 갱신만 늦어질 뿐 데이터는 이미 저장됨). */
export async function publishOrgEvent(orgId: string, event: OrgEvent): Promise<void> {
  try {
    await getPublisher().publish(orgChannel(orgId), JSON.stringify(event));
  } catch {
    // 무시
  }
}

/** SSE 연결마다 구독용 연결을 따로 만든다 (Redis 구독 연결은 다른 명령을 못 쓴다). */
export function createSubscriber(): Redis {
  const sub = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  sub.on("error", () => {});
  return sub;
}
