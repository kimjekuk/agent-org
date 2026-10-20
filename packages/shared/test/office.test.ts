// F201 사무실 배치: 상태별 위치, 리더 방, 책상 자동 (최대 12), 자리 모자랄 때
import { describe, expect, it } from "vitest";
import { deskSeat, LEADER_SEAT, LOUNGE_SEATS, MAX_DESKS, MEETING_SEATS, officeLayout, officeZone } from "../src/office";

describe("사무실 배치", () => {
  it("작업 중 = 자기 자리, 회의·검토 = 회의 테이블, 대기 = 휴게, 막힘·멈춤 = 자기 자리", () => {
    expect(officeZone({ status: "WORKING", activity: "WORK" }, false)).toBe("DESK");
    expect(officeZone({ status: "WORKING", activity: "WORK" }, true)).toBe("LEADER");
    expect(officeZone({ status: "WORKING", activity: "MEETING" }, false)).toBe("MEETING");
    expect(officeZone({ status: "WORKING", activity: "REVIEW" }, true)).toBe("MEETING");
    expect(officeZone({ status: "IDLE" }, false)).toBe("LOUNGE");
    expect(officeZone({ status: "BLOCKED" }, false)).toBe("DESK");
    expect(officeZone({ status: "PAUSED" }, true)).toBe("LEADER");
  });

  it("첫 리더는 리더 방, 나머지는 채용 순서대로 책상. 대기 중이면 휴게 공간 자리를 차례로", () => {
    const { placements, deskCount } = officeLayout([
      { id: "a", rank: "LEADER", status: "WORKING", activity: "WORK" },
      { id: "b", rank: "MEMBER", status: "WORKING", activity: "WORK" },
      { id: "c", rank: "MEMBER", status: "IDLE" },
      { id: "d", rank: "MEMBER", status: "IDLE" },
      { id: "e", rank: "MEMBER", status: "WORKING", activity: "MEETING" },
    ]);
    expect(deskCount).toBe(4);
    const at = Object.fromEntries(placements.map((p) => [p.id, p]));
    expect(at.a).toMatchObject({ zone: "LEADER", at: LEADER_SEAT, seat: { kind: "LEADER" } });
    expect(at.b).toMatchObject({ zone: "DESK", at: deskSeat(0) });
    expect(at.c).toMatchObject({ zone: "LOUNGE", at: LOUNGE_SEATS[0], seat: { kind: "DESK", index: 1 } });
    expect(at.d.at).toEqual(LOUNGE_SEATS[1]);
    expect(at.e).toMatchObject({ zone: "MEETING", at: MEETING_SEATS[0] });
  });

  it("책상은 최대 12개, 넘는 사람은 일할 때도 휴게 공간에 선다", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, rank: "MEMBER" as const, status: "WORKING" as const, activity: "WORK" as const }));
    const { placements, deskCount } = officeLayout(many);
    expect(deskCount).toBe(MAX_DESKS);
    expect(placements.filter((p) => p.zone === "DESK")).toHaveLength(MAX_DESKS);
    expect(placements.slice(MAX_DESKS).every((p) => p.zone === "LOUNGE" && p.seat === null)).toBe(true);
  });
});
