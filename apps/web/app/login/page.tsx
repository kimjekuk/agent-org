import { redirect } from "next/navigation";
import { getSessionUser, hasAnyUser } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  if (!(await hasAnyUser())) redirect("/setup");
  if (await getSessionUser()) redirect("/agents");
  const { setup } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold">AgentOrg</h1>
        {setup && <p className="mt-1 text-sm text-green-700 dark:text-green-400">계정을 만들었습니다. 로그인해 주세요.</p>}
      </div>
      <LoginForm />
    </main>
  );
}
