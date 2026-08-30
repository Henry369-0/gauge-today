// 7 日 uptime 条带（#02 热力图同款美学）：每格一天，绿=稳定，黄=降级，红=挂，灰=无探测

import { fmtPct } from '@/lib/format';

const DAY_MS = 86400_000;

function dayColor(ratio: number | null): string {
  if (ratio == null) return 'rgba(43,43,38,0.13)';
  if (ratio >= 0.98) return 'var(--color-moss)';
  if (ratio >= 0.8) return 'var(--color-moss-soft)';
  if (ratio >= 0.5) return 'var(--color-mustard)';
  if (ratio > 0) return 'var(--color-brick-deep)';
  return 'var(--color-brick)';
}

export function UptimeStrip({
  strip,
  cell = 13,
  gap = 3,
  height = 15,
  labels = true,
}: {
  strip: (number | null)[];
  cell?: number;
  gap?: number;
  height?: number;
  labels?: boolean;
}) {
  const width = strip.length * cell + (strip.length - 1) * gap;
  const today = new Date();
  return (
    <div>
      <svg width={width} height={height} aria-label="7 日 uptime 条带">
        {strip.map((r, i) => {
          const daysAgo = strip.length - 1 - i;
          const d = new Date(today.getTime() - daysAgo * DAY_MS);
          const title = `${d.getMonth() + 1}/${d.getDate()} · ${r == null ? '无探测' : `uptime ${fmtPct(r, 1)}`}`;
          return (
            <rect
              key={i}
              x={i * (cell + gap)}
              y={0}
              width={cell}
              height={height}
              rx={2.5}
              fill={dayColor(r)}
              stroke="rgba(43,43,38,0.25)"
              strokeWidth={0.5}
            >
              <title>{title}</title>
            </rect>
          );
        })}
      </svg>
      {labels && (
        <div className="tnum flex text-[9px] text-ink-faint" style={{ width }}>
          <span>7天前</span>
          <span className="ml-auto">今天</span>
        </div>
      )}
    </div>
  );
}
