// F203 통계 그래프 (서버에서 그리는 SVG). 한 가지 값만 보여 주므로 색은 파란색 하나 (밝은/어두운 화면 각각),
// 값·이름은 글자색으로 바로 적고, 막대마다 마우스를 올리면 정확한 값이 뜬다 (<title>)

import { INTL_LOCALE, type Locale } from "@agentorg/shared/i18n";
import { getLocale, getT } from "@/lib/i18n";

const wonFmt = (locale: Locale) => new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 1 });
const BAR = "fill-[#2a78d6] dark:fill-[#3987e5]";

/** 날짜별 세로 막대 (7·30일). 가장 큰 값과 마지막 날 값만 글자로 */
export async function DailyBars({ data, height = 120, compact = false }: { data: { day: string; krw: number; calls: number }[]; height?: number; compact?: boolean }) {
  const t = await getT();
  const won = wonFmt(await getLocale());
  const w = 320;
  const top = compact ? 4 : 16;
  const bottom = compact ? 4 : 18;
  const plotH = height - top - bottom;
  const max = Math.max(...data.map((d) => d.krw), 0);
  const slot = w / Math.max(data.length, 1);
  const barW = Math.min(24, Math.max(3, slot - 2));
  const peak = data.findIndex((d) => d.krw === max && max > 0);
  const label = (i: number) => data.length <= 7 || i === 0 || i === data.length - 1 || i % 7 === 6;

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="block w-full" role="img" aria-label={t("날짜별 비용: {list}", { list: data.map((d) => `${d.day.slice(5)} ${t("{n}원", { n: won.format(d.krw) })}`).join(", ") })}>
      <line x1={0} x2={w} y1={top + plotH + 0.5} y2={top + plotH + 0.5} className="stroke-black/20 dark:stroke-white/25" strokeWidth={1} />
      {data.map((d, i) => {
        const h = max > 0 ? Math.max(d.krw > 0 ? 2 : 0, (d.krw / max) * plotH) : 0;
        const x = i * slot + (slot - barW) / 2;
        const y = top + plotH - h;
        const r = Math.min(4, barW / 2, h);
        return (
          <g key={d.day}>
            <title>{`${d.day} · ${t("{n}원", { n: won.format(d.krw) })} · ${t("호출 {n}번", { n: d.calls })}`}</title>
            {/* 누르기 쉬운 영역 */}
            <rect x={i * slot} y={top} width={slot} height={plotH} fill="transparent" />
            {h > 0 && <path d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`} className={BAR} />}
            {!compact && i === peak && (
              <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={10} className="fill-current">
                {t("{n}원", { n: won.format(d.krw) })}
              </text>
            )}
            {!compact && label(i) && (
              <text x={i * slot + slot / 2} y={height - 4} textAnchor="middle" fontSize={9} className="fill-current opacity-60">
                {d.day.slice(5).replace("-", "/")}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** 가로 막대 순위 (에이전트·모델별). 이름·값은 막대 옆에 글자로 */
export async function RankBars({ rows }: { rows: { key: string; label: string; value: number; note?: string }[] }) {
  const t = await getT();
  const won = wonFmt(await getLocale());
  const amount = (v: number) => t("{n}원", { n: won.format(v) });
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (rows.length === 0) return <p className="text-sm opacity-60">{t("기록이 없습니다.")}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1" title={`${r.label} · ${amount(r.value)}${r.note ? ` · ${r.note}` : ""}`}>
          <div className="flex items-baseline gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-semibold">{r.label}</span>
            <span className="shrink-0 tabular-nums">
              {amount(r.value)}
            </span>
            {r.note && <span className="shrink-0 text-xs opacity-60">{r.note}</span>}
          </div>
          <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="block h-2 w-full" aria-hidden>
            <rect x={0} y={0} width={100} height={6} rx={3} className="fill-black/5 dark:fill-white/10" />
            {r.value > 0 && <rect x={0} y={0} width={Math.max(2, (r.value / max) * 100)} height={6} rx={3} className={BAR} />}
          </svg>
        </li>
      ))}
    </ul>
  );
}
