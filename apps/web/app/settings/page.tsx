import { getDb, schema } from "@agentorg/shared/db";
import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/session";
import { buttonDanger, buttonGhost, card } from "@/lib/ui";
import { logout } from "../login/actions";
import { deleteApiKey, deleteOrg, selectOrg } from "./actions";
import { ApiKeyForm, CreateOrgForm, RenameOrgForm } from "./forms";

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });

// /settings — 계정·API 키(F001)·조직(F002). PRD 4장 네비게이션
export default async function SettingsPage() {
  const user = await requireUser();
  const db = getDb();
  const orgs = await db
    .select({ id: schema.organizations.id, name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.ownerId, user.id))
    .orderBy(asc(schema.organizations.createdAt));
  const keys = await db
    .select({ provider: schema.apiKeys.provider, createdAt: schema.apiKeys.createdAt })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.userId, user.id));
  const currentOrgId = (await cookies()).get("org")?.value;
  const anthropicKey = keys.find((k) => k.provider === "anthropic");

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-4 pb-12">
      <header className="flex items-center justify-between pt-2">
        <h1 className="text-xl font-bold">설정</h1>
        <form action={logout}>
          <button type="submit" className={buttonGhost}>
            로그아웃
          </button>
        </form>
      </header>

      <section className={`${card} flex flex-col gap-3`}>
        <h2 className="font-semibold">조직</h2>
        {orgs.length === 0 && <p className="text-sm opacity-70">아직 조직이 없습니다. 첫 조직을 만들어 주세요.</p>}
        <ul className="flex flex-col gap-3">
          {orgs.map((org) => {
            const current = org.id === currentOrgId;
            return (
              <li key={org.id} className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/15">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {org.name}
                    {current && <span className="ml-2 rounded bg-foreground px-1.5 py-0.5 text-xs text-background">선택됨</span>}
                  </span>
                  {!current && (
                    <form action={selectOrg}>
                      <input type="hidden" name="id" value={org.id} />
                      <button type="submit" className={buttonGhost}>
                        선택
                      </button>
                    </form>
                  )}
                </div>
                <RenameOrgForm id={org.id} name={org.name} />
                <details>
                  <summary className="cursor-pointer py-2 text-sm text-red-600 dark:text-red-400">조직 삭제</summary>
                  <form action={deleteOrg} className="flex flex-col gap-2 pt-1">
                    <input type="hidden" name="id" value={org.id} />
                    <p className="text-sm opacity-80">
                      &ldquo;{org.name}&rdquo;과 그 안의 에이전트·미션·산출물이 모두 삭제됩니다. 되돌릴 수 없습니다.
                    </p>
                    <button type="submit" className={buttonDanger}>
                      정말 삭제
                    </button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
        <CreateOrgForm />
      </section>

      <section className={`${card} flex flex-col gap-3`}>
        <h2 className="font-semibold">API 키 — Claude (Anthropic)</h2>
        <p className="text-sm opacity-70">
          {anthropicKey
            ? `등록됨 (${dateFmt.format(anthropicKey.createdAt)}) · 보안을 위해 키는 다시 보여주지 않습니다.`
            : "미등록. 키는 암호화해서 저장하고 다시 보여주지 않습니다."}
        </p>
        <ApiKeyForm provider="anthropic" registered={Boolean(anthropicKey)} />
        {anthropicKey && (
          <form action={deleteApiKey}>
            <input type="hidden" name="provider" value="anthropic" />
            <button type="submit" className={`${buttonGhost} w-full text-red-600 dark:text-red-400`}>
              키 삭제
            </button>
          </form>
        )}
      </section>

      <section className={`${card} flex flex-col gap-1`}>
        <h2 className="font-semibold">계정</h2>
        <p className="text-sm opacity-70">{user.email}</p>
      </section>
    </main>
  );
}
