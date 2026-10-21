// F209 예약 화면 문구: shared describeSchedule와 같은 규칙을 화면 언어로 (서버·클라이언트 공용)
import { dateFormat, type Locale, type T } from "@agentorg/shared/i18n";
import type { schema } from "@agentorg/shared/db";

type Schedule = typeof schema.schedules.$inferSelect;

/** 요일 이름 (0=일요일). 2024-01-07은 일요일 */
export function weekdayNames(locale: Locale): string[] {
  const fmt = dateFormat(locale, { weekday: "short" });
  return Array.from({ length: 7 }, (_, d) => fmt.format(new Date(Date.UTC(2024, 0, 7 + d, 3))));
}

export function describeWhen(t: T, locale: Locale, s: Pick<Schedule, "repeat" | "time" | "weekdays" | "dayOfMonth" | "runDate">): string {
  if (s.repeat === "ONCE") return t("{date} {time} 한 번", { date: s.runDate ?? "", time: s.time });
  if (s.repeat === "DAILY") return t("매일 {time}", { time: s.time });
  if (s.repeat === "WEEKLY") {
    const names = weekdayNames(locale);
    return t("매주 {days} {time}", { days: [...(s.weekdays ?? [])].sort().map((d) => names[d]).join("·"), time: s.time });
  }
  return t("매월 {d}일 {time}", { d: s.dayOfMonth ?? 1, time: s.time });
}
