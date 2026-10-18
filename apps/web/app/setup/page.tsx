import { redirect } from "next/navigation";
import { hasAnyUser } from "@/lib/session";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";

// F001: 계정이 하나도 없을 때만 열리는 첫 계정 화면 (PRD 12장 서버 자동화)
export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold">AgentOrg</h1>
        <p className="mt-1 text-sm opacity-70">처음 오셨네요. 관리자 계정을 만들어 주세요.</p>
      </div>
      <SetupForm />
      <p className="text-center text-xs opacity-60">이 화면은 계정이 하나도 없을 때만 나타납니다.</p>
    </main>
  );
}
