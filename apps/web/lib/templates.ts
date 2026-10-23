// F208 지시 템플릿을 화면용으로 (기본 템플릿은 화면 언어로 번역)
import { getDb } from "@agentorg/shared/db";
import { type DirectiveTemplate, listDirectiveTemplates } from "@agentorg/shared/directiveTemplates";
import { getT } from "@/lib/i18n";

export async function loadTemplates(orgId: string): Promise<DirectiveTemplate[]> {
  const t = await getT();
  return (await listDirectiveTemplates(getDb(), orgId)).map((x) => (x.builtin ? { ...x, title: t(x.title), content: t(x.content) } : x));
}
