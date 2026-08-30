import { NextResponse } from 'next/server';
import { getDb, getSettings, setSetting } from '@gauge/shared';

export const dynamic = 'force-dynamic';

const NUMERIC_KEYS = [
  'budget_daily',
  'interval_common_sec',
  'interval_longtail_sec',
  'interval_corpse_sec',
  'concurrency',
  'timeout_ms',
  'rate_limit_backoff',
  'keep_probes_days',
] as const;

const TEXT_KEYS = ['base_url', 'api_key'] as const;

const EDITABLE = new Set<string>([...NUMERIC_KEYS, ...TEXT_KEYS]);
const ALL_KEYS: string[] = [...NUMERIC_KEYS, ...TEXT_KEYS];

export async function GET() {
  const db = getDb();
  const s = getSettings(db);
  const hb = Number(s.prober_heartbeat_at || 0);
  return NextResponse.json({
    settings: Object.fromEntries(ALL_KEYS.map((k) => [k, s[k]])),
    prober_alive: Date.now() - hb < 60_000 && hb > 0,
    prober_heartbeat_at: hb || null,
    last_discovery_at: Number(s.last_discovery_at || 0) || null,
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const db = getDb();
  const applied: string[] = [];
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE.has(key)) {
      rejected.push(key);
      continue;
    }
    if (NUMERIC_KEYS.includes(key as (typeof NUMERIC_KEYS)[number])) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        rejected.push(key);
        continue;
      }
      // 安全底线：超时不得低于 1s、并发不得高于 20（防误伤上游限流）
      if (key === 'timeout_ms' && n < 1000) {
        rejected.push(key);
        continue;
      }
      if (key === 'concurrency' && n > 20) {
        rejected.push(key);
        continue;
      }
      setSetting(db, key, String(Math.round(n)));
    } else {
      const v = String(value ?? '').trim();
      if (key === 'base_url' && !/^https?:\/\//.test(v)) {
        rejected.push(key);
        continue;
      }
      setSetting(db, key, v);
    }
    applied.push(key);
  }
  return NextResponse.json({ ok: true, applied, rejected });
}
