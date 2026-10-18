import { getDb, schema } from "@agentorg/shared/db";
import { PRICING_PAGES, PROVIDER_LABEL, PROVIDERS, type ProviderName } from "@agentorg/shared/llm/models";
import { asc, eq } from "drizzle-orm";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { buttonDanger, buttonGhost, card } from "@/lib/ui";
import { logout } from "@/app/login/actions";
import { deleteApiKey, deleteOrg, selectOrg } from "./actions";
import { ApiKeyForm, CreateOrgForm, RenameOrgForm, TestConnectionForm } from "./forms";
import { toggleModel } from "./model-actions";
import { DeleteModelForm, ModelForm } from "./model-forms";

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
  const currentOrgId = (await getCurrentOrg(user.id))?.id;
  const models = await db.select().from(schema.llmModels).orderBy(asc(schema.llmModels.provider), asc(schema.llmModels.label));
  const providerOptions = PROVIDERS.filter((p) => p !== "anthropic").map((p) => ({ value: p, label: PROVIDER_LABEL[p] }));

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

      <section className="flex flex-col gap-3" aria-label="API 키">
        <h2 className="px-1 font-semibold">API 키</h2>
        <p className="px-1 text-sm opacity-70">쓰려는 회사의 키만 등록하면 됩니다. 키는 암호화해서 저장하고 다시 보여주지 않습니다.</p>
        {PROVIDERS.map((p) => {
          const key = keys.find((k) => k.provider === p);
          return (
            <details key={p} className={card} open={p === "anthropic" && !key}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold">
                {PROVIDER_LABEL[p]}
                <span className={`rounded-full px-2 py-0.5 text-xs ${key ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200" : "bg-black/10 dark:bg-white/15"}`}>
                  {key ? `등록됨 ${dateFmt.format(key.createdAt)}` : "미등록"}
                </span>
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                <ApiKeyForm provider={p} registered={Boolean(key)} />
                {key && <TestConnectionForm provider={p} />}
                {key && (
                  <form action={deleteApiKey}>
                    <input type="hidden" name="provider" value={p} />
                    <button type="submit" className={`${buttonGhost} w-full text-red-600 dark:text-red-400`}>
                      키 삭제
                    </button>
                  </form>
                )}
              </div>
            </details>
          );
        })}
      </section>

      <section className={`${card} flex flex-col gap-3`} aria-label="모델·요금">
        <h2 className="font-semibold">모델·요금</h2>
        <p className="text-sm opacity-70">
          Claude 모델은 기본으로 들어 있습니다. 다른 회사 모델은 공식 요금 페이지에서 <b>모델 이름과 요금을 확인한 뒤</b> 켜야 씁니다. 꺼진 것은 검색으로 찾은 후보라 틀릴 수 있습니다.
        </p>
        <ul className="flex flex-col gap-2">
          {models.map((m) => (
            <li key={m.id} className="rounded-lg border border-black/10 p-3 dark:border-white/15">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{m.label}</p>
                  <p className="truncate text-xs opacity-70">
                    {PROVIDER_LABEL[m.provider as ProviderName] ?? m.provider} · {m.id} · 입력 ${Number(m.inputUsd)} / 출력 ${Number(m.outputUsd)}
                    {m.cachedInputUsd != null ? ` / 캐시 $${Number(m.cachedInputUsd)}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${m.enabled ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"}`}>
                  {m.enabled ? "사용 중" : "확인 필요"}
                </span>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm underline-offset-2">{m.enabled ? "요금 고치기 · 끄기" : "공식 요금 확인하고 켜기"}</summary>
                <div className="mt-2 flex flex-col gap-2">
                  <p className="break-all text-xs opacity-70">공식 요금: {PRICING_PAGES[m.provider as ProviderName] ?? "-"}</p>
                  <ModelForm providers={providerOptions} initial={{ id: m.id, provider: m.provider, label: m.label, inputUsd: m.inputUsd, outputUsd: m.outputUsd, cachedInputUsd: m.cachedInputUsd }} />
                  {m.enabled && (
                    <form action={toggleModel}>
                      <input type="hidden" name="id" value={m.id} />
                      <button type="submit" className={`${buttonGhost} w-full`}>
                        이 모델 끄기
                      </button>
                    </form>
                  )}
                  <DeleteModelForm id={m.id} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        <details>
          <summary className="cursor-pointer text-sm font-semibold">+ 모델 추가</summary>
          <div className="mt-2">
            <ModelForm providers={providerOptions} />
          </div>
        </details>
      </section>

      <section className={`${card} flex flex-col gap-1`}>
        <h2 className="font-semibold">계정</h2>
        <p className="text-sm opacity-70">{user.email}</p>
      </section>
    </main>
  );
}
