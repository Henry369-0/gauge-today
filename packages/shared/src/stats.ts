// dashboard 侧的全部读查询 + 聚合。写路径在 prober（state.ts）。
// 性能基调（§8）：probes ≤3000 行/日，一次取 7 天数据在 JS 分组，避免逐模型 N+1。

import type { DatabaseSync } from 'node:sqlite';
import type {
  EndpointStatus,
  ModelView,
  Overview,
  ProviderCard,
  RouterCandidate,
  RouterSuggestion,
  TaskType,
  Tier,
} from './types';
import { getSettings, numSetting } from './db';

// ---------- 小工具 ----------

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

interface ProbeLite {
  model_id: string;
  ts: number;
  ok: number;
  latency_ms: number | null;
}

/** 一次性取最近 days 天的探测记录，按 model_id 分组 */
function loadProbesByModel(db: DatabaseSync, days: number): Map<string, ProbeLite[]> {
  const since = Date.now() - days * 86400_000;
  const rows = db
    .prepare('SELECT model_id, ts, ok, latency_ms FROM probes WHERE ts >= ? ORDER BY ts')
    .all(since) as unknown as ProbeLite[];
  const map = new Map<string, ProbeLite[]>();
  for (const r of rows) {
    let list = map.get(r.model_id);
    if (!list) map.set(r.model_id, (list = []));
    list.push(r);
  }
  return map;
}

/** 7 日条带：每天 ok/(ok+fail)，无探测为 null。旧→新，最后一位是今天。 */
function dailyStrip(probes: ProbeLite[], days = 7): (number | null)[] {
  const today0 = startOfLocalDay(Date.now());
  const buckets: { ok: number; total: number }[] = Array.from({ length: days }, () => ({
    ok: 0,
    total: 0,
  }));
  for (const p of probes) {
    const dayIdx = days - 1 - Math.floor((today0 - startOfLocalDay(p.ts)) / 86400_000);
    if (dayIdx < 0 || dayIdx >= days) continue;
    buckets[dayIdx]!.total++;
    if (p.ok) buckets[dayIdx]!.ok++;
  }
  return buckets.map((b) => (b.total === 0 ? null : b.ok / b.total));
}

/** 24h sparkline：按 30 分钟桶取 ok 探测延迟中位，无探测为 null。旧→新。
 *  半小时粒度：上线头一小时就有 ≥2 个点，sparkline 立刻可读。 */
function hourlyLatencySpark(probes: ProbeLite[]): (number | null)[] {
  const BUCKET_MS = 1800_000; // 30min
  const nowB = Math.floor(Date.now() / BUCKET_MS);
  const byBucket = new Map<number, number[]>();
  for (const p of probes) {
    if (!p.ok || p.latency_ms == null) continue;
    const b = Math.floor(p.ts / BUCKET_MS);
    if (b <= nowB - 48) continue;
    let list = byBucket.get(b);
    if (!list) byBucket.set(b, (list = []));
    list.push(p.latency_ms);
  }
  const out: (number | null)[] = [];
  for (let b = nowB - 47; b <= nowB; b++) out.push(median(byBucket.get(b) ?? []));
  return out;
}

function computeP50P95(
  probes: ProbeLite[],
  windowMs: number,
): { p50: number | null; p95: number | null; samples: number } {
  const since = Date.now() - windowMs;
  const lats = probes
    .filter((p) => p.ok && p.ts >= since && p.latency_ms != null)
    .map((p) => p.latency_ms!)
    .sort((a, b) => a - b);
  return { p50: percentile(lats, 50), p95: percentile(lats, 95), samples: lats.length };
}

function taskTagFilter(task: TaskType): { sql: string; arg: string } | null {
  // text 是默认能力，不做标记过滤；其余标签在 discover 时启发式写入 task_types
  if (task === 'text') return null;
  return { sql: " AND (' ' || m.task_types || ' ') LIKE ?", arg: `% ${task} %` };
}

// ---------- 总览 ----------

export function getOverview(db: DatabaseSync): Overview {
  const settings = getSettings(db);
  const rows = db
    .prepare('SELECT status, COUNT(*) AS n FROM models WHERE enabled = 1 GROUP BY status')
    .all() as unknown as { status: EndpointStatus; n: number }[];
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;

  const today0 = startOfLocalDay(Date.now());
  const todayAgg = db
    .prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS fails FROM probes WHERE ts >= ?')
    .get(today0) as unknown as { total: number; fails: number | null };

  // P50：优先最近 2h，没有样本退回 24h
  let p50_ms: number | null = null;
  let p50_window_label = '最近 2 小时';
  const lats2h = db
    .prepare('SELECT latency_ms FROM probes WHERE ok = 1 AND ts >= ? AND latency_ms IS NOT NULL')
    .all(Date.now() - 2 * 3600_000) as unknown as { latency_ms: number }[];
  if (lats2h.length > 0) {
    p50_ms = median(lats2h.map((r) => r.latency_ms));
  } else {
    const lats24h = db
      .prepare('SELECT latency_ms FROM probes WHERE ok = 1 AND ts >= ? AND latency_ms IS NOT NULL')
      .all(Date.now() - 24 * 3600_000) as unknown as { latency_ms: number }[];
    p50_window_label = '最近 24 小时';
    p50_ms = median(lats24h.map((r) => r.latency_ms));
  }

  const hb = Number(settings.prober_heartbeat_at || 0);
  const gwOk = Number(settings.gateway_ok_at || 0);
  const gwErr = Number(settings.gateway_err_at || 0);

  // 24h 故障时间线（按本地小时分桶）
  const nowH = Math.floor(Date.now() / 3600_000);
  const probes = db
    .prepare('SELECT ts, ok FROM probes WHERE ts >= ?')
    .all((nowH - 23) * 3600_000) as unknown as { ts: number; ok: number }[];
  const buckets = new Map<number, { oks: number; fails: number }>();
  for (const r of probes) {
    const h = Math.floor(r.ts / 3600_000);
    let b = buckets.get(h);
    if (!b) buckets.set(h, (b = { oks: 0, fails: 0 }));
    if (r.ok) b.oks++;
    else b.fails++;
  }
  const timeline24h = Array.from({ length: 24 }, (_, i) => {
    const h = nowH - 23 + i;
    const b = buckets.get(h) ?? { oks: 0, fails: 0 };
    return {
      hour: h,
      label: `${String(new Date(h * 3600_000).getHours()).padStart(2, '0')}:00`,
      oks: b.oks,
      fails: b.fails,
    };
  });

  return {
    gateway_up: !(gwErr > gwOk && Date.now() - gwErr < 5 * 60_000),
    total_enabled: rows.reduce((s, r) => s + r.n, 0),
    up_count: byStatus['up'] ?? 0,
    degraded_count: byStatus['degraded'] ?? 0,
    down_count: byStatus['down'] ?? 0,
    unknown_count: byStatus['unknown'] ?? 0,
    budget_daily: numSetting(settings, 'budget_daily'),
    budget_used_today: todayAgg?.total ?? 0,
    failures_today: todayAgg?.fails ?? 0,
    p50_ms,
    p50_window_label,
    prober_heartbeat_at: hb > 0 ? hb : null,
    prober_alive: Date.now() - hb < 60_000,
    timeline24h,
  };
}

// ---------- 健康墙 ----------

export function getProviderCards(db: DatabaseSync): ProviderCard[] {
  const models = db
    .prepare('SELECT id, provider_id, status FROM models WHERE enabled = 1')
    .all() as unknown as { id: string; provider_id: string; status: EndpointStatus }[];
  const providers = db
    .prepare('SELECT id, name, last_checked_at FROM providers ORDER BY name')
    .all() as unknown as { id: string; name: string; last_checked_at: number | null }[];

  const byModel = loadProbesByModel(db, 7);
  const cards = new Map<string, ProviderCard>();
  for (const p of providers) {
    cards.set(p.id, {
      id: p.id,
      name: p.name,
      status: 'unknown',
      total: 0,
      up: 0,
      degraded: 0,
      down: 0,
      last_checked_at: p.last_checked_at,
      spark: Array.from({ length: 24 }, () => null),
      strip: Array.from({ length: 7 }, () => null),
    });
  }

  const mergedProbes = new Map<string, ProbeLite[]>(); // provider_id → probes
  for (const m of models) {
    const card = cards.get(m.provider_id);
    if (!card) continue;
    card.total++;
    if (m.status === 'up') card.up++;
    else if (m.status === 'degraded') card.degraded++;
    else if (m.status === 'down') card.down++;
    const probes = byModel.get(m.id);
    if (probes && probes.length) {
      let agg = mergedProbes.get(m.provider_id);
      if (!agg) mergedProbes.set(m.provider_id, (agg = []));
      for (const p of probes) agg.push(p);
    }
  }

  for (const card of cards.values()) {
    const agg = mergedProbes.get(card.id) ?? [];
    card.spark = hourlyLatencySpark(agg);
    card.strip = dailyStrip(agg);
    if (card.total === 0) continue; // 该供应商没有启用中的端点，保持 unknown
    if (card.up > 0) card.status = 'up';
    else if (card.degraded > 0) card.status = 'degraded';
    else if (card.down > 0) card.status = 'down';
  }

  return [...cards.values()]
    .filter((c) => c.total > 0)
    .sort(
      (a, b) =>
        b.up / b.total - a.up / a.total || a.name.localeCompare(b.name),
    );
}

// ---------- 模型浏览器 ----------

export interface ModelFilter {
  provider?: string;
  status?: EndpointStatus | '';
  tier?: Tier | '';
  task?: TaskType | '';
  q?: string;
}

export function getModelViews(db: DatabaseSync, filter: ModelFilter = {}): ModelView[] {
  let sql = `SELECT m.*, p.name AS provider_name FROM models m JOIN providers p ON p.id = m.provider_id WHERE m.enabled = 1`;
  const args: string[] = [];
  if (filter.provider) {
    sql += ' AND m.provider_id = ?';
    args.push(filter.provider);
  }
  if (filter.status) {
    sql += ' AND m.status = ?';
    args.push(filter.status);
  }
  if (filter.tier) {
    sql += ' AND m.tier = ?';
    args.push(filter.tier);
  }
  if (filter.q) {
    sql += ' AND (m.model_name LIKE ? OR m.id LIKE ?)';
    args.push(`%${filter.q}%`, `%${filter.q}%`);
  }
  if (filter.task) {
    const t = taskTagFilter(filter.task);
    if (t) {
      sql += t.sql;
      args.push(t.arg);
    }
  }
  const raw = db.prepare(sql).all(...args) as unknown as (Omit<ModelView, 'enabled'> & {
    enabled: number;
  })[];

  const byModel = loadProbesByModel(db, 7);
  // node:sqlite 的行对象是 null 原型，直接传给 Client Component 会被 Next 序列化拒绝——
  // 出厂前统一 JSON 轮转成普通对象
  return JSON.parse(JSON.stringify(raw.map((r) => {
    const probes = byModel.get(r.id) ?? [];
    const { p50, p95, samples } = computeP50P95(probes, 24 * 3600_000);
    return {
      ...r,
      enabled: !!r.enabled,
      p50_ms: p50,
      p95_ms: p95,
      samples_24h: samples,
      strip: dailyStrip(probes),
    };
  })));
}

/** 模型浏览器筛选器的供应商下拉（普通对象，可直接传 Client Component） */
export function getProviderOptions(db: DatabaseSync): { id: string; name: string }[] {
  const rows = db
    .prepare(
      'SELECT p.id, p.name FROM providers p WHERE EXISTS(SELECT 1 FROM models m WHERE m.provider_id = p.id AND m.enabled = 1) ORDER BY p.name',
    )
    .all() as unknown as { id: string; name: string }[];
  return JSON.parse(JSON.stringify(rows));
}

// ---------- 路由建议器 ----------

export function getRouterSuggestion(db: DatabaseSync, task: TaskType): RouterSuggestion {
  let sql = `SELECT id, provider_id, status FROM models WHERE enabled = 1 AND status IN ('up','degraded')`;
  const args: string[] = [];
  const tf = taskTagFilter(task);
  if (tf) {
    sql += tf.sql.replace('m.', '');
    args.push(tf.arg);
  }
  const models = db.prepare(sql).all(...args) as unknown as {
    id: string;
    provider_id: string;
    status: EndpointStatus;
  }[];
  const byModel = loadProbesByModel(db, 2);

  const candidates: RouterCandidate[] = [];
  for (const m of models) {
    const probes = byModel.get(m.id) ?? [];
    // 排序窗口：优先最近 2h；样本 <3 退回 24h
    let win = computeP50P95(probes, 2 * 3600_000);
    if (win.samples < 3) win = computeP50P95(probes, 24 * 3600_000);
    const since24 = Date.now() - 24 * 3600_000;
    const okCount = probes.filter((p) => p.ok && p.ts >= since24).length;
    const total24 = probes.filter((p) => p.ts >= since24).length;
    candidates.push({
      model_id: m.id,
      provider_id: m.provider_id,
      status: m.status,
      p50_ms: win.p50,
      samples: win.samples,
      uptime_24h: total24 > 0 ? okCount / total24 : null,
    });
  }

  candidates.sort((a, b) => {
    const ua = a.status === 'up' ? 0 : 1;
    const ub = b.status === 'up' ? 0 : 1;
    if (ua !== ub) return ua - ub;
    const la = a.p50_ms ?? Number.MAX_SAFE_INTEGER;
    const lb = b.p50_ms ?? Number.MAX_SAFE_INTEGER;
    if (la !== lb) return la - lb;
    return b.samples - a.samples;
  });

  return {
    task_type: task,
    generated_at: Date.now(),
    window_label: '基于最近 2h 真实探测（样本不足自动回退 24h）',
    chain: candidates.slice(0, 3),
  };
}

export function saveFallbackChain(
  db: DatabaseSync,
  name: string,
  taskType: string,
  steps: string[],
): void {
  db.prepare(
    'INSERT INTO fallback_chains(name, task_type, steps_json, created_at) VALUES(?, ?, ?, ?)',
  ).run(name, taskType, JSON.stringify(steps), Date.now());
}
