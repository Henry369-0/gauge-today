// demo 模式：内置一个"模拟 freellmapi"，让没有真实网关也能跑通全链路。
//   pnpm demo          → 模拟上游(:3010) + 探测器（快速节奏），另开终端 pnpm dev 看仪表盘
//   pnpm demo -- --fresh → 顺手清空 demo 数据库
// 模拟上游是确定性剧本：快/慢/限流/5xx/空响应/401/周期抖动，各占几个端点，
// 用来演示错误分类、防抖、降频和路由建议器。

import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

process.env.GAUGE_DB_PATH ??= fileURLToPath(new URL('../../../data/demo.db', import.meta.url));

const { getDb, setSetting } = await import('@gauge/shared');
const { Scheduler } = await import('./scheduler.js');
const { startMockUpstream, MODELS } = await import('./mock-upstream.js');

const db = getDb();

if (process.argv.includes('--fresh')) {
  db.exec('DELETE FROM probes; DELETE FROM models; DELETE FROM providers;');
  setSetting(db, 'last_discovery_at', '0');
  console.log('[demo] 已清空 demo 数据库');
}

// 快节奏设置（正式环境是 300/1800/7200 秒，见 shared/db.ts）
setSetting(db, 'base_url', 'http://127.0.0.1:3010');
setSetting(db, 'api_key', 'demo-key');
setSetting(db, 'budget_daily', '3000');
setSetting(db, 'interval_common_sec', '10');
setSetting(db, 'interval_longtail_sec', '20');
setSetting(db, 'interval_corpse_sec', '30');
setSetting(db, 'concurrency', '5');
setSetting(db, 'timeout_ms', '8000');

// 首次 demo：给 7 天"演示历史"，健康墙的条带/sparkline 一打开就有故事可讲
const probeCount = db.prepare('SELECT COUNT(*) AS n FROM probes').get() as unknown as { n: number };
if (probeCount.n === 0) {
  seedDemoHistory(db);
  console.log('[demo] 已生成 7 天演示历史数据（仅 demo 模式）');
}

await startMockUpstream(3010);
console.log('[demo] 模拟 freellmapi → http://127.0.0.1:3010');
console.log('[demo] 探测器启动（demo 节奏 10s/20s/30s）。另开终端运行 pnpm dev → http://localhost:3100\n');

const scheduler = new Scheduler(db);
void scheduler.runForever();
// 一键全家桶：顺手把仪表盘也拉起来（同一个 demo 数据库）
if (!process.argv.includes('--no-dashboard')) {
  const { spawn } = await import('node:child_process');
  const isWin = process.platform === 'win32';
  const child = spawn(isWin ? 'pnpm.cmd --filter @gauge/dashboard dev' : 'pnpm --filter @gauge/dashboard dev', {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    env: { ...process.env, GAUGE_DB_PATH: process.env.GAUGE_DB_PATH! },
    stdio: 'inherit',
    shell: isWin,
  });
  const bye = () => {
    child.kill();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

/** 7 天演示历史：按每个模型的剧本行为合成探测记录，条带/sparkline 立刻可读 */
function seedDemoHistory(db: DatabaseSync): void {
  const ins = db.prepare('INSERT INTO probes(model_id, ts, ok, latency_ms, error_class) VALUES(?, ?, ?, ?, ?)');
  const now = Date.now();
  const base: Record<string, number> = {
    ok: 300,
    slow: 4600,
    rate: 350,
    wobble: 480,
    err5xx: 260,
    empty: 380,
    auth: 200,
  };
  for (const m of MODELS) {
    const b = base[m.behavior] ?? 400;
    for (let day = 6; day >= 0; day--) {
      const day0 = new Date();
      day0.setHours(0, 0, 0, 0);
      const start = day0.getTime() - day * 86400_000;
      // 白天密集、夜里稀疏，间隔 ~35min ± 抖动
      for (let t = start + 7 * 3600_000; t < Math.min(start + 23.5 * 3600_000, now); t += (30 + Math.random() * 20) * 60_000) {
        const hour = new Date(t).getHours();
        if (hour < 7 || hour > 23) continue;
        if (t > now) break;
        let ok = true;
        let err: string | null = null;
        if (m.behavior === 'err5xx' || m.behavior === 'auth' || m.behavior === 'empty') {
          // 历史一直健康，今天才"出事"——条带讲得出"什么时候开始挂的"
          ok = day > 0;
          err = ok ? null : m.behavior === 'auth' ? 'auth_failed' : m.behavior === 'empty' ? 'empty_response' : 'upstream_error';
        } else if (m.behavior === 'rate') {
          ok = Math.random() > (day === 0 ? 0.55 : 0.25);
          err = ok ? null : 'rate_limited';
        } else {
          ok = Math.random() > 0.03;
          err = ok ? null : 'upstream_error';
        }
        const latency = Math.round(b * (0.7 + Math.random() * 0.6));
        ins.run(m.id, Math.round(t), ok ? 1 : 0, ok ? latency : latency, err);
      }
    }
  }
}
