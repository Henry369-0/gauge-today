import Link from 'next/link';
import { getDb, getProviderCards } from '@gauge/shared';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Sparkline } from '@/components/Sparkline';
import { UptimeStrip } from '@/components/UptimeStrip';
import { StatusBadge } from '@/components/StatusDot';
import { fmtMs, timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function WallPage() {
  const db = getDb();
  const cards = getProviderCards(db);
  const up = cards.filter((c) => c.status === 'up').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">健康墙</h1>
          <p className="text-xs text-ink-soft">
            {cards.length} 家供应商 · {up} 家全绿 · 点卡片进端点明细
          </p>
        </div>
        <AutoRefresh seconds={20} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.id}
            href={`/models?provider=${encodeURIComponent(c.id)}`}
            className="card block p-3 hover:bg-paper-deep/50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-bold" title={c.name}>
                {c.name}
              </span>
              <StatusBadge status={c.status} />
            </div>
            <div className="tnum mt-0.5 text-[11px] text-ink-soft">
              {c.up}/{c.total} 活 · {c.degraded} 黄 · {c.down} 红 · 探测 {timeAgo(c.last_checked_at)}
            </div>
            <div className="mt-2">
              <UptimeStrip strip={c.strip} />
            </div>
            <div className="mt-1.5 flex items-end justify-between">
              <Sparkline points={c.spark} />
              <span className="text-[10px] text-ink-faint">24h 延迟</span>
            </div>
          </Link>
        ))}
      </div>

      {cards.length === 0 && (
        <div className="card p-8 text-center text-sm text-ink-soft">
          还没有端点数据。先跑 <code className="tnum">pnpm discover</code>（或{' '}
          <code className="tnum">pnpm demo</code>）把端点清单拉进 SQLite。
        </div>
      )}

      <p className="text-[11px] text-ink-soft">
        条带 = 最近 7 天每天的成功率（灰 = 当天无探测）；折线 = 24h 逐小时成功延迟中位。
        状态语义：<span className="text-moss">墨绿=活</span> /{' '}
        <span className="text-mustard">芥末黄=限流</span> /{' '}
        <span className="text-brick">砖红=挂</span>。
      </p>
    </div>
  );
}
