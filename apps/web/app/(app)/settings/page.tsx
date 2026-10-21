import { getDb, schema } from "@agentorg/shared/db";
import { listModelChoices, PRICING_PAGES, PROVIDER_LABEL, PROVIDERS, type ProviderName } from "@agentorg/shared/llm/models";
import { asc, eq } from "drizzle-orm";
import { getCurrentOrg } from "@/lib/org";
import { requireUser } from "@/lib/session";
import { button, buttonDanger, buttonGhost, card, input } from "@/lib/ui";
import { logout } from "@/app/login/actions";
import { deleteApiKey, deleteOrg, selectOrg } from "./actions";
import { ApiKeyForm, CreateOrgForm, RenameOrgForm, TestConnectionForm } from "./forms";
import { saveBudgetDaily, saveFallbackModel, saveOfficeTheme, toggleModel } from "./model-actions";
import { OFFICE_THEMES, type OfficeTheme } from "@agentorg/shared/agents/templates";
import { DeleteModelForm, ModelForm } from "./model-forms";
import { listExportChannels } from "@agentorg/shared/export";
import { deleteChannel } from "./export-actions";
import { EmailChannelForm, SlackChannelForm } from "./export-forms";

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
  const currentOrg = await getCurrentOrg(user.id);
  const currentOrgId = currentOrg?.id;
  const models = await db.select().from(schema.llmModels).orderBy(asc(schema.llmModels.provider), asc(schema.llmModels.label));
  const modelChoices = await listModelChoices(db);
  const exportChannels = currentOrg ? await listExportChannels(db, currentOrg.id) : [];
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

      {currentOrg && (
        <section className={`${card} flex flex-col gap-3`} aria-label="하루 예산">
          <h2 className="font-semibold">하루 예산</h2>
          <p className="text-sm opacity-70">
            {currentOrg.name}이(가) 하루에 AI에 쓸 수 있는 금액입니다. 80%부터 절약 모델로 바꾸고, 다 쓰면 그날은 멈춥니다. Max 5x 월 API 크레딧($100 ≈ 14만 원) 안에서 쓰려면 하루 4,000원 이하가 안전합니다.
          </p>
          <form key={currentOrg.budgetDaily} action={saveBudgetDaily} className="flex gap-2">
            <label className="flex flex-1 items-center gap-2">
              <input name="budgetDaily" type="number" inputMode="numeric" min={100} max={1000000} step={100} required defaultValue={currentOrg.budgetDaily} className={input} aria-label="하루 예산(원)" />
              <span className="shrink-0 text-sm">원</span>
            </label>
            <button type="submit" className={`${button} shrink-0`}>
              저장
            </button>
          </form>
        </section>
      )}

      {currentOrg && (
        <section id="export" className="flex scroll-mt-4 flex-col gap-3" aria-label="내보내기 연결">
          <h2 className="px-1 font-semibold">내보내기 연결</h2>
          <p className="px-1 text-sm opacity-70">미션 최종 결과 화면의 &lsquo;보내기&rsquo;로 쓸 곳입니다. 보낼 때마다 승인함에서 승인해야 나갑니다. 비밀번호·웹훅 주소는 암호화해서 저장하고 다시 보여주지 않습니다.</p>
          {(
            [
              ["SLACK", "💬 슬랙", "슬랙 앱 설정 → Incoming Webhooks → 채널을 골라 만든 주소를 붙여 넣으세요."],
              ["EMAIL", "✉️ 이메일", "Gmail은 Google 계정 → 보안 → 2단계 인증을 켠 뒤 '앱 비밀번호'를 만들어 넣으세요."],
            ] as const
          ).map(([kind, title, help]) => {
            const ch = exportChannels.find((c) => c.kind === kind);
            return (
              <details key={kind} className={card}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold">
                  {title}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${ch ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200" : "bg-black/10 dark:bg-white/15"}`}>{ch ? "연결됨" : "미연결"}</span>
                </summary>
                <div className="mt-3 flex flex-col gap-2">
                  {ch && <p className="break-all text-sm opacity-80">{ch.label}</p>}
                  <p className="text-xs opacity-70">{help}</p>
                  {kind === "SLACK" ? <SlackChannelForm registered={Boolean(ch)} /> : <EmailChannelForm registered={Boolean(ch)} />}
                  {ch && (
                    <form action={deleteChannel}>
                      <input type="hidden" name="kind" value={kind} />
                      <button type="submit" className={`${buttonGhost} w-full text-red-600 dark:text-red-400`}>
                        연결 삭제
                      </button>
                    </form>
                  )}
                </div>
              </details>
            );
          })}
        </section>
      )}

      {currentOrg && (
        <section className={`${card} flex flex-col gap-3`} aria-label="사무실 테마">
          <h2 className="font-semibold">사무실 테마</h2>
          <p className="text-sm opacity-70">대시보드·사무실 화면의 바닥과 벽 색입니다.</p>
          <form action={saveOfficeTheme} className="grid grid-cols-2 gap-2">
            {(Object.keys(OFFICE_THEMES) as OfficeTheme[]).map((k) => {
              const t = OFFICE_THEMES[k];
              const on = currentOrg.officeTheme === k;
              return (
                <button
                  key={k}
                  type="submit"
                  name="theme"
                  value={k}
                  aria-pressed={on}
                  className={`flex h-14 items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${on ? "border-foreground ring-2 ring-foreground" : "border-black/15 dark:border-white/15"}`}
                >
                  <span className="flex shrink-0 overflow-hidden rounded border border-black/20" aria-hidden>
                    <span className="h-6 w-4" style={{ background: t.floor }} />
                    <span className="h-6 w-4" style={{ background: t.wall }} />
                    <span className="h-6 w-4" style={{ background: t.rug }} />
                  </span>
                  {t.label}
                </button>
              );
            })}
          </form>
        </section>
      )}

      {currentOrg && (
        <section className={`${card} flex flex-col gap-3`} aria-label="장애 시 대체 모델">
          <h2 className="font-semibold">장애 시 대체 모델</h2>
          <p className="text-sm opacity-70">
            AI 회사 서버가 과부하·오류·시간 초과일 때 이 모델로 한 번 더 시도합니다 ({currentOrg.name}). 다른 회사 모델이면 그 회사 API 키가 있어야 합니다.
          </p>
          <form action={saveFallbackModel} className="flex flex-col gap-2">
            <select key={currentOrg.fallbackModel ?? ""} name="fallbackModel" defaultValue={currentOrg.fallbackModel ?? ""} className={`${input} appearance-none`} aria-label="대체 모델">
              <option value="">쓰지 않음 (실패로 처리)</option>
              {modelChoices.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <button type="submit" className={button}>
              저장
            </button>
          </form>
        </section>
      )}

      <section className={`${card} flex flex-col gap-1`}>
        <h2 className="font-semibold">계정</h2>
        <p className="text-sm opacity-70">{user.email}</p>
      </section>
    </main>
  );
}
