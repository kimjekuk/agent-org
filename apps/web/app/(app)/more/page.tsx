import Link from "next/link";
import { PushToggle } from "@/components/PushToggle";
import { MORE_LINKS } from "@/lib/nav";
import { requireUser } from "@/lib/session";
import { card } from "@/lib/ui";

export const dynamic = "force-dynamic";

// F017 하단 탭바 '더보기': 탭바에 없는 화면들 + 알림 켜기
export default async function MorePage() {
  const user = await requireUser();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-12">
      <h1 className="text-xl font-bold">더보기</h1>
      <ul className={`${card} flex flex-col divide-y divide-black/10 p-0 dark:divide-white/15`}>
        {MORE_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex h-14 items-center gap-3 px-4 font-semibold">
              <span aria-hidden>{l.icon}</span>
              <span className="flex-1">{l.label}</span>
              <span aria-hidden className="opacity-50">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <section className={`${card} flex flex-col gap-2`}>
        <h2 className="font-semibold">휴대폰 알림</h2>
        <p className="text-sm opacity-80">승인 요청·예산 경고·미션 완료를 알림으로 받습니다. 이 기기에서 한 번 켜 주세요.</p>
        <PushToggle />
      </section>
      <p className="text-center text-xs opacity-60">{user.email}</p>
    </main>
  );
}
