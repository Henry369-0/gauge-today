'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { timeAgo } from '@/lib/format';

interface SettingsPayload {
  settings: Record<string, string>;
  prober_alive: boolean;
  prober_heartbeat_at: number | null;
  last_discovery_at: number | null;
}

const FIELDS: { key: string; label: string; hint: string; unit?: string; password?: boolean }[] = [
  { key: 'base_url', label: '网关地址', hint: 'freellmapi 的地址，如 http://localhost:3001' },
  { key: 'api_key', label: '统一 API Key', hint: 'Dashboard → Keys → Unified API key（freellmapi-…）', password: true },
  { key: 'budget_daily', label: '每日探测预算', hint: '全局每日探测请求上限，预算耗尽只保常用层', unit: '次/日' },
  { key: 'interval_common_sec', label: '常用层间隔', hint: '★ 标记的端点', unit: '秒' },
  { key: 'interval_longtail_sec', label: '长尾层间隔', hint: '其余端点', unit: '秒' },
  { key: 'interval_corpse_sec', label: '尸体层间隔', hint: '连 down 超 3 天的端点（尸体不插旗）', unit: '秒' },
  { key: 'concurrency', label: '并发数', hint: '并发池上限（≤20，避免触发上游限流）' },
  { key: 'timeout_ms', label: '超时线', hint: '超过即判 timeout（慢死）', unit: 'ms' },
  { key: 'rate_limit_backoff', label: '429 降频倍数', hint: '被限流端点的间隔 × 倍数', unit: '×' },
  { key: 'keep_probes_days', label: '探测记录保留', hint: 'probes 表每日清理', unit: '天' },
];

export function SettingsForm() {
  const router = useRouter();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  async function load() {
    const res = await fetch('/api/settings');
    const j = (await res.json()) as SettingsPayload;
    setData(j);
    setDraft(j.settings);
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      const changed: Record<string, string> = {};
      for (const [k, v] of Object.entries(draft)) {
        if (data && data.settings[k] !== v) changed[k] = v;
      }
      if (Object.keys(changed).length === 0) {
        setMsg('没有改动');
        return;
      }
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changed),
      });
      const j = (await res.json()) as { applied: string[]; rejected: string[] };
      const parts: string[] = [];
      if (j.applied.length) parts.push(`已保存 ${j.applied.length} 项（prober 下一 tick 生效，无需重启）`);
      if (j.rejected.length) parts.push(`被拒: ${j.rejected.join(', ')}`);
      setMsg(parts.join(' · '));
      await load();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function rediscover() {
    await fetch('/api/discover', { method: 'POST' });
    setMsg('已请求重新发现端点，prober 将在 2 秒内拉取 /v1/models');
  }

  if (!data) return <div className="card p-6 text-sm text-ink-soft">载入中…</div>;

  return (
    <div className="space-y-4">
      <div className="card p-3 text-xs">
        {data.prober_alive ? (
          <span className="text-moss">
            ● prober 在线，心跳 {timeAgo(data.prober_heartbeat_at)} · 上次发现端点{' '}
            {timeAgo(data.last_discovery_at)}
          </span>
        ) : (
          <span className="text-brick">
            ● prober 离线（心跳 {timeAgo(data.prober_heartbeat_at)}）——设置仍会保存，等 prober 启动后生效
          </span>
        )}
      </div>

      <div className="card grid gap-x-6 gap-y-4 p-4 md:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-xs">
            <span className="font-bold">{f.label}</span>
            <span className="ml-2 text-ink-faint">{f.hint}</span>
            <span className="mt-1 flex items-center gap-1">
              <input
                type={f.password && !showKey ? 'password' : 'text'}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                className="tnum w-full border border-ink/40 bg-paper px-2 py-1.5 outline-none focus:border-ink"
              />
              {f.unit && <span className="whitespace-nowrap text-ink-soft">{f.unit}</span>}
              {f.password && (
                <button type="button" onClick={() => setShowKey(!showKey)} className="btn px-2 py-1.5 text-[10px]">
                  {showKey ? '隐藏' : '显示'}
                </button>
              )}
            </span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={saving} className="btn btn-primary px-4 py-2 text-xs">
          {saving ? '保存中…' : '保存设置'}
        </button>
        <button onClick={rediscover} className="btn px-4 py-2 text-xs">
          立即重新发现端点
        </button>
        {msg && <span className="text-xs text-moss">{msg}</span>}
      </div>

      <p className="text-[11px] text-ink-soft">
        设置存在 SQLite 的 settings 表里，prober 每个 tick（2 秒）重读——改完即生效，不用重启。
        环境变量 <code>GAUGE_BASE_URL</code> / <code>GAUGE_API_KEY</code> 只在对应键还没写入时的首次种子。
      </p>
    </div>
  );
}
