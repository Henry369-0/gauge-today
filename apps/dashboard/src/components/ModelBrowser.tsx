'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { EndpointStatus, ModelView, TaskType, Tier } from '@gauge/shared/labels';
import { TIER_LABEL } from '@gauge/shared/labels';
import { UptimeStrip } from '@/components/UptimeStrip';
import { fmtMs, fmtPct, timeAgo } from '@/lib/format';

const STATUS_OPTS: { value: EndpointStatus | ''; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'up', label: '活' },
  { value: 'degraded', label: '黄（限流）' },
  { value: 'down', label: '挂' },
  { value: 'unknown', label: '未知' },
];

const TIER_OPTS: { value: Tier | ''; label: string }[] = [
  { value: '', label: '全部层级' },
  { value: 'common', label: '常用（5min）' },
  { value: 'longtail', label: '长尾（30min）' },
  { value: 'corpse', label: '尸体（2h）' },
];

const TASK_OPTS: { value: TaskType | ''; label: string }[] = [
  { value: '', label: '全部任务' },
  { value: 'vision', label: '视觉' },
  { value: 'text', label: '文本' },
  { value: 'longcontext', label: '长上下文' },
  { value: 'function', label: '函数调用' },
];

type SortKey = 'p50' | 'p95' | 'name' | 'provider';

export function ModelBrowser({
  models,
  providers,
  initialProvider,
}: {
  models: ModelView[];
  providers: { id: string; name: string }[];
  initialProvider: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [provider, setProvider] = useState(initialProvider);
  const [status, setStatus] = useState<EndpointStatus | ''>('');
  const [tier, setTier] = useState<Tier | ''>('');
  const [task, setTask] = useState<TaskType | ''>('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('p50');
  const [starring, setStarring] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let rows = models;
    if (provider) rows = rows.filter((m) => m.provider_id === provider);
    if (status) rows = rows.filter((m) => m.status === status);
    if (tier) rows = rows.filter((m) => m.tier === tier);
    if (task) rows = rows.filter((m) => m.task_types.split(' ').includes(task));
    if (q.trim()) {
      const kw = q.trim().toLowerCase();
      rows = rows.filter(
        (m) => m.model_name.toLowerCase().includes(kw) || m.id.toLowerCase().includes(kw),
      );
    }
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sort === 'name') return a.model_name.localeCompare(b.model_name);
      if (sort === 'provider')
        return a.provider_name.localeCompare(b.provider_name) || a.model_name.localeCompare(b.model_name);
      const key = sort === 'p50' ? 'p50_ms' : 'p95_ms';
      const la = a[key] ?? Number.MAX_SAFE_INTEGER;
      const lb = b[key] ?? Number.MAX_SAFE_INTEGER;
      return la - lb;
    });
    return sorted;
  }, [models, provider, status, tier, task, q, sort]);

  async function toggleStar(m: ModelView) {
    setStarring(m.id);
    try {
      await fetch('/api/models/star', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: m.id, star: m.tier !== 'common' }),
      });
      startTransition(() => router.refresh());
    } finally {
      setStarring(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* 筛选器 */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="border border-ink/40 bg-paper-card px-2 py-1.5 text-xs"
        >
          <option value="">全部供应商</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as EndpointStatus | '')}
          className="border border-ink/40 bg-paper-card px-2 py-1.5 text-xs"
        >
          {STATUS_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as Tier | '')}
          className="border border-ink/40 bg-paper-card px-2 py-1.5 text-xs"
        >
          {TIER_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={task}
          onChange={(e) => setTask(e.target.value as TaskType | '')}
          className="border border-ink/40 bg-paper-card px-2 py-1.5 text-xs"
          title="任务类型标签为模型名启发式推断，仅供筛选"
        >
          {TASK_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜模型名…"
          className="w-40 border border-ink/40 bg-paper-card px-2 py-1.5 text-xs outline-none focus:border-ink"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="border border-ink/40 bg-paper-card px-2 py-1.5 text-xs"
        >
          <option value="p50">按 P50 排序</option>
          <option value="p95">按 P95 排序</option>
          <option value="name">按模型名</option>
          <option value="provider">按供应商</option>
        </select>
        <span className="tnum ml-auto text-xs text-ink-soft">
          {filtered.length} / {models.length} 个端点
          {pending && <span className="ml-2 text-ink-faint">保存中…</span>}
        </span>
      </div>

      {/* 表格 */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-xs">
          <thead>
            <tr className="border-b border-ink/50 text-[11px] text-ink-soft">
              <th className="w-8 px-2 py-2"></th>
              <th className="px-2 py-2">模型</th>
              <th className="px-2 py-2">供应商</th>
              <th className="px-2 py-2">层级</th>
              <th className="px-2 py-2">状态</th>
              <th className="px-2 py-2 text-right">P50</th>
              <th className="px-2 py-2 text-right">P95</th>
              <th className="px-2 py-2">7 日条带</th>
              <th className="px-2 py-2 text-right">样本24h</th>
              <th className="px-2 py-2 text-right">最近探测</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id} className="border-b border-ink/10 hover:bg-paper-deep/40">
                <td className="px-2 py-1.5">
                  <button
                    onClick={() => toggleStar(m)}
                    disabled={starring === m.id}
                    title={m.tier === 'common' ? '取消常用（回到长尾层）' : '标记常用（5 分钟一探）'}
                    className={`text-sm leading-none ${m.tier === 'common' ? 'text-mustard' : 'text-ink-faint hover:text-mustard'}`}
                  >
                    {m.tier === 'common' ? '★' : '☆'}
                  </button>
                </td>
                <td className="max-w-[300px] truncate px-2 py-1.5 font-mono text-[11px]" title={m.id}>
                  {m.model_name}
                </td>
                <td className="px-2 py-1.5 text-ink-soft">{m.provider_name}</td>
                <td className="px-2 py-1.5">
                  <TierBadge tier={m.tier} />
                </td>
                <td className="px-2 py-1.5">
                  <StatusPill status={m.status} error={m.last_error_class} />
                </td>
                <td className="tnum px-2 py-1.5 text-right">{fmtMs(m.p50_ms)}</td>
                <td className="tnum px-2 py-1.5 text-right text-ink-soft">{fmtMs(m.p95_ms)}</td>
                <td className="px-2 py-1">
                  <UptimeStrip strip={m.strip} cell={10} gap={2} height={11} labels={false} />
                </td>
                <td className="tnum px-2 py-1.5 text-right text-ink-soft">{m.samples_24h}</td>
                <td className="tnum px-2 py-1.5 text-right text-ink-soft" title={m.last_error_message ?? ''}>
                  {timeAgo(m.last_checked_at)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-2 py-8 text-center text-ink-soft">
                  没有匹配的端点
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-soft">
        ★ = 常用层（每 5 分钟探测）；层级自动流转：连 down 3 天 → 尸体层（2h），恢复即出坟。
        延迟为最近 24h 成功探测的 P50/P95。
      </p>
    </div>
  );
}

function TierBadge({ tier }: { tier: Tier }) {
  const cls =
    tier === 'common'
      ? 'bg-mustard/25 text-ink border-ink/30'
      : tier === 'corpse'
        ? 'bg-brick/15 text-brick-deep border-ink/20'
        : 'bg-ink/5 text-ink-soft border-ink/20';
  return <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${cls}`}>{TIER_LABEL[tier]}</span>;
}

function StatusPill({ status, error }: { status: EndpointStatus; error?: string | null }) {
  const style: Record<EndpointStatus, { dot: string; text: string }> = {
    up: { dot: 'bg-moss', text: 'text-moss' },
    degraded: { dot: 'bg-mustard', text: 'text-mustard' },
    down: { dot: 'bg-brick', text: 'text-brick' },
    unknown: { dot: 'bg-ink-faint', text: 'text-ink-faint' },
  };
  const s = style[status];
  const label =
    status === 'up'
      ? '活'
      : status === 'degraded'
        ? `黄 · ${error ?? ''}`
        : status === 'down'
          ? `挂 · ${error ?? ''}`
          : '未探测';
  return (
    <span className={`inline-flex items-center gap-1 ${s.text}`}>
      <span className={`inline-block size-2 rounded-full ${s.dot}`} />
      {label}
    </span>
  );
}
