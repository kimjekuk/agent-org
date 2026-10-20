import Link from "next/link";
import { notFound } from "next/navigation";
import { Office } from "@/components/Office";
import { loadOffice } from "@/lib/office";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// F201 사무실 전체 화면: 확대(1~3배)·스크롤로 이동, 캐릭터를 누르면 카드에서 바로 지시. SSE로 자동 갱신
export default async function OfficePage() {
  const user = await requireUser();
  const org = await getCurrentOrg(user.id);
  if (!org) notFound();
  const { agents, deskCount } = await loadOffice(org);
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-3 p-4 pb-12">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-xl font-bold">🏢 사무실</h1>
        <Link href="/dashboard" className="text-sm opacity-70">
          ← 대시보드
        </Link>
      </div>
      {agents.length === 0 ? (
        <p className="text-sm opacity-70">
          아직 에이전트가 없습니다.{" "}
          <Link href="/agents" className="underline">
            채용하기
          </Link>
        </p>
      ) : (
        <Office agents={agents} deskCount={deskCount} full />
      )}
      <p className="text-xs opacity-60">작업 중 = 자기 책상 · 회의·검토 = 회의실 · 대기 = 휴게 공간 · ❗ 막힘 · ⏸ 멈춤 · 💤 근무 시간 밖</p>
    </main>
  );
}
