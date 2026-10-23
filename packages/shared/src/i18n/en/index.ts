// 영어 사전: 화면별 파일을 합친다. 키 = 한국어 원문 (packages/shared/test/i18n.test.ts가 빠진 키를 찾는다)
import { agents } from "./agents";
import { common } from "./common";
import { missions } from "./missions";
import { settings } from "./settings";
import { templates } from "./templates";
import { work } from "./work";

export const en: Record<string, string> = { ...common, ...missions, ...agents, ...settings, ...work, ...templates };
