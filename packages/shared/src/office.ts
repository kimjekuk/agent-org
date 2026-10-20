// F201 사무실 뷰 (2026-10-20 결정): 위에서 내려다본 픽셀아트 사무실 한 장. 이 파일은 그림 좌표와 '누가 어디에 있나'만 정한다 (그림은 web)
// - 작업 중 = 자기 책상, 회의·검토 = 회의 테이블, 대기·휴식 = 휴게 공간, 막힘·멈춤 = 자기 자리에서 표시
// - 책상은 에이전트 수에 맞춰 자동 (리더는 유리 칸막이 방, 나머지 최대 12자리)

/** 그림 크기 (SVG viewBox 단위). 휴대폰(375px)에서는 이 비율 그대로 축소된다 */
export const OFFICE_W = 320;
export const OFFICE_H = 256;
export const MAX_DESKS = 12;

export type OfficeZone = "LEADER" | "DESK" | "MEETING" | "LOUNGE";
/** 지금 처리 중인 일의 종류 (작업 중일 때만) */
export type OfficeActivity = "WORK" | "MEETING" | "REVIEW";

export interface Point {
  x: number;
  y: number;
}

export const ROOMS = {
  leader: { x: 4, y: 4, w: 92, h: 84 },
  meeting: { x: 100, y: 4, w: 116, h: 84 },
  pantry: { x: 220, y: 4, w: 96, h: 84 },
  desks: { x: 4, y: 92, w: 312, h: 100 },
  lounge: { x: 4, y: 196, w: 312, h: 56 },
} as const;

/** 리더 책상과 의자 자리 */
export const LEADER_DESK = { x: 26, y: 30, w: 44, h: 14 };
export const LEADER_SEAT: Point = { x: 48, y: 62 };

/** 일반 책상 i번 (6자리씩 2줄) */
export function deskAt(i: number): { x: number; y: number; w: number; h: number } {
  const col = i % 6;
  const row = Math.floor(i / 6);
  return { x: 10 + col * 51, y: 102 + row * 46, w: 40, h: 12 };
}
export function deskSeat(i: number): Point {
  const d = deskAt(i);
  return { x: d.x + 20, y: d.y + 30 };
}

export const MEETING_TABLE = { x: 126, y: 42, w: 64, h: 20 };
/** 회의 테이블 둘레 8자리 */
export const MEETING_SEATS: Point[] = [
  { x: 138, y: 40 },
  { x: 158, y: 40 },
  { x: 178, y: 40 },
  { x: 138, y: 82 },
  { x: 158, y: 82 },
  { x: 178, y: 82 },
  { x: 116, y: 60 },
  { x: 202, y: 60 },
];

/** 휴게 공간: 소파 4자리 + 테이블 둘레 6자리 */
export const LOUNGE_SEATS: Point[] = [
  { x: 30, y: 232 },
  { x: 48, y: 232 },
  { x: 66, y: 232 },
  { x: 84, y: 232 },
  { x: 136, y: 228 },
  { x: 156, y: 248 },
  { x: 176, y: 228 },
  { x: 196, y: 248 },
  { x: 216, y: 228 },
  { x: 116, y: 248 },
];

export interface OfficeAgentInput {
  id: string;
  rank: "LEADER" | "MANAGER" | "MEMBER";
  status: "IDLE" | "WORKING" | "PAUSED" | "BLOCKED";
  /** 작업 중이면 무엇을 하는지 */
  activity?: OfficeActivity | null;
}

export interface OfficePlacement {
  id: string;
  zone: OfficeZone;
  /** 캐릭터 발 위치 */
  at: Point;
  /** 자기 자리 (리더 방 또는 책상 번호). 자리가 없으면 null */
  seat: { kind: "LEADER" } | { kind: "DESK"; index: number } | null;
}

/** 지금 있어야 할 곳: 작업 중(회의·검토 제외) = 자기 자리, 회의·검토 = 회의 테이블, 대기 = 휴게 공간, 막힘·멈춤 = 자기 자리 */
export function officeZone(a: Pick<OfficeAgentInput, "status" | "activity">, hasLeaderSeat: boolean): OfficeZone {
  const own: OfficeZone = hasLeaderSeat ? "LEADER" : "DESK";
  if (a.status === "WORKING") return a.activity === "MEETING" || a.activity === "REVIEW" ? "MEETING" : own;
  if (a.status === "IDLE") return "LOUNGE";
  return own;
}

/**
 * 자리 배치. agents는 들어온 순서(채용 순)대로 준다.
 * 리더 방은 첫 리더, 책상은 나머지 순서대로 최대 12개. 자리가 없는 사람은 일할 때도 휴게 공간에 선다.
 * 회의 테이블·휴게 공간 자리가 모자라면 마지막 자리 근처에 겹쳐 선다.
 */
export function officeLayout(agents: OfficeAgentInput[]): { placements: OfficePlacement[]; deskCount: number } {
  const leader = agents.find((a) => a.rank === "LEADER");
  const others = agents.filter((a) => a !== leader);
  const deskCount = Math.min(MAX_DESKS, others.length);
  const seatOf = new Map<string, OfficePlacement["seat"]>();
  if (leader) seatOf.set(leader.id, { kind: "LEADER" });
  others.slice(0, MAX_DESKS).forEach((a, i) => seatOf.set(a.id, { kind: "DESK", index: i }));

  let meeting = 0;
  let lounge = 0;
  const placements = agents.map((a): OfficePlacement => {
    const seat = seatOf.get(a.id) ?? null;
    let zone = officeZone(a, seat?.kind === "LEADER");
    if (!seat && (zone === "DESK" || zone === "LEADER")) zone = "LOUNGE";
    let at: Point;
    if (zone === "MEETING") at = slot(MEETING_SEATS, meeting++);
    else if (zone === "LOUNGE") at = slot(LOUNGE_SEATS, lounge++);
    else if (seat?.kind === "LEADER") at = LEADER_SEAT;
    else at = deskSeat((seat as { index: number }).index);
    return { id: a.id, zone, at, seat };
  });
  return { placements, deskCount };
}

function slot(seats: Point[], n: number): Point {
  if (n < seats.length) return seats[n];
  const last = seats[seats.length - 1];
  return { x: last.x - 6 * (n - seats.length + 1), y: last.y };
}
