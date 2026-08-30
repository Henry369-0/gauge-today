import Link from 'next/link';
import { getDb, getOverview } from '@gauge/shared';
import { AutoRefresh } from '@/components/AutoRefresh';
import { fmtMs, fmtNum, timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function OverviewPage() {
  const db = getDb();
  const o = getOverview(db);

  const budgetLeft = Math.max(0, o.budget_daily - o.budget_used_today);
  const budgetRatio = o.budget_daily > 0 ? Math.min(1, o.budget_used_today / o.budget_daily) : 0;
  const maxFails = Math.max(1, ...o.timeline24h.map((h) => h.fails));
  const W = 720;
  const H = 96;
  const bw = W / 24;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">总览</h1>
        <AutoRefresh seconds={15} />
      </div>

      {/* 网关 / 探测器横幅 */}
      {!o.gateway_up && (
        <div className="card border-brick px-4 py-3 text-sm text-brick-deep">
          <strong>freellmapi 网关不可达</strong> —— 探测请求连不上{' '}
          <code className="tnum">base_url</code>。这不计入任何端点的失败；确认网关进程在跑后探测会自动恢复。
        </div>
      )}
      {!o.prober_alive && (
        <div className="card px-4 py-3 text-sm text-ink-soft">
          <strong className="text-ink">探测器未运行</strong> —— 心跳停在中{' '}
          <span className="tnum">{timeAgo(o.prober_heartbeat_at)}</span>。运行{' '}
          <code className="tnum">pnpm prober</code> 开始探测（或 <code className="tnum">pnpm demo</code> 体验模式）。
        </div>
      )}

      {/* 四张大数字卡 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigCard
          label="可用端点"
          value={`${o.up_count}`}
          sub={`共 ${o.total_enabled} 个 · 黄 ${o.degraded_count} · 红 ${o.down_count}`}
          accent="text-moss"
          href="/wall"
        />
        <BigCard
          label="探测预算剩余"
          value={fmtNum(budgetLeft)}
          sub={`今日已用 ${fmtNum(o.budget_used_today)} / ${fmtNum(o.budget_daily)}`}
          accent={budgetLeft === 0 ? 'text-brick' : 'text-ink'}
          bar={{ ratio: budgetRatio, warn: budgetRatio > 0.85 }}
        />
        <BigCard
          label="今日故障"
          value={`${o.failures_today}`}
          sub={`红 ${o.down_count} · 黄 ${o.degraded_count} 个端点受影响`}
          accent={o.failures_today > 0 ? 'text-brick' : 'text-moss'}
        />
        <BigCard
          label="P50 延迟"
          value={fmtMs(o.p50_ms)}
          sub={`${o.p50_window_label} · 成功探测中位`}
          accent="text-ink"
        />
      </div>

      {/* 24h 故障时间线 */}
      <section className="card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-bold">24 小时探测时间线</h2>
          <span className="text-[11px] text-ink-soft">
            <span className="mr-2 inline-block size-2 rounded-sm bg-brick align-middle" />
            失败
            <span className="ml-3 mr-1 inline-block size-2 rounded-sm bg-moss/35 align-middle" />
            成功
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full" role="img" aria-label="24小时故障时间线">
          {o.timeline24h.map((h, i) => {
            const okH = h.oks > 0 ? Math.min(10, 3 + Math.log2(h.oks + 1) * 2) : 0;
            const failH = (h.fails / maxFails) * (H - 14);
            const x = i * bw;
            return (
              <g key={h.hour}>
                {/* 成功：底部细条（对数压扁，只作背景带） */}
                {h.oks > 0 && (
                  <rect
                    x={x + 1.5}
                    y={H - okH}
                    width={bw - 3}
                    height={okH}
                    fill="var(--color-moss)"
                    opacity={0.28}
                  >
                    <title>{`${h.label} 成功 ${h.oks} 次`}</title>
                  </rect>
                )}
                {/* 失败：砖红色带 */}
                {h.fails > 0 && (
                  <rect x={x + 1.5} y={H - failH} width={bw - 3} height={failH} fill="var(--color-brick)">
                    <title>{`${h.label} 失败 ${h.fails} 次`}</title>
                  </rect>
                )}
                {h.fails === 0 && h.oks === 0 && (
                  <rect x={x + 1.5} y={H - 2} width={bw - 3} height={2} fill="rgba(43,43,38,0.12)">
                    <title>{`${h.label} 无探测`}</title>
                  </rect>
                )}
                {i % 4 === 0 && (
                  <text x={x + 2} y={H + 12} fontSize={9} fill="var(--color-ink-soft)" className="tnum">
                    {h.label}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={0} y1={H} x2={W} y2={H} stroke="rgba(43,43,38,0.4)" strokeWidth={1} />
        </svg>
        <p className="mt-2 text-[11px] text-ink-soft">
          预算按层瓜分（常用 5min / 长尾 30min / 尸体 2h），耗尽只保常用层——
          详见 <Link href="/settings" className="underline">设置</Link>。
        </p>
      </section>
    </div>
  );
}

function BigCard({
  label,
  value,
  sub,
  accent,
  href,
  bar,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
  href?: string;
  bar?: { ratio: number; warn: boolean };
}) {
  const inner = (
    <>
      <div className="text-[11px] tracking-wide text-ink-soft">{label}</div>
      <div className={`tnum mt-1 text-4xl font-bold leading-none ${accent}`}>{value}</div>
      <div className="mt-2 text-[11px] text-ink-soft">{sub}</div>
      {bar && (
        <div className="mt-2 h-1.5 w-full rounded-full bg-ink/10">
          <div
            className={`h-1.5 rounded-full ${bar.warn ? 'bg-brick' : 'bg-moss'}`}
            style={{ width: `${(bar.ratio * 100).toFixed(1)}%` }}
          />
        </div>
      )}
    </>
  );
  const cls = 'card block p-4';
  return href ? (
    <Link href={href} className={`${cls} hover:bg-paper-deep/60`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
