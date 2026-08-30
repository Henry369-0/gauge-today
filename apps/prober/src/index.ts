// 常驻入口：pnpm prober（探测） / pnpm discover（只拉一次清单就退出）

import { getDb, setSetting, getSetting, getSettings } from '@gauge/shared';
import { Scheduler } from './scheduler.js';
import { discover } from './discover.js';
import { loadConfig } from './config.js';

const db = getDb();

if (process.argv.includes('--discover-only')) {
  const cfg = loadConfig(db);
  discover(db, cfg)
    .then((r) => {
      console.log(
        `[discover] 端点 ${r.discovered} · 新增 ${r.added} · 停用 ${r.disabled} · 供应商 ${r.providers}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('[discover] 失败:', (err as Error).message);
      process.exit(1);
    });
} else {
  const s = getSettings(db);
  const masked = s.api_key ? `${s.api_key.slice(0, 6)}…` : '（未配置，探测会 401）';
  console.log('gauge.today prober · 免费仪表盘探测器');
  console.log(`  网关   : ${s.base_url}`);
  console.log(`  统一key: ${masked}`);
  console.log(`  预算   : ${s.budget_daily} 次/日 · 并发 ${s.concurrency} · 超时 ${s.timeout_ms}ms`);
  console.log('  Ctrl+C 退出。仪表盘：pnpm dev → http://localhost:3100\n');
  setSetting(db, 'prober_pid', String(process.pid));

  const scheduler = new Scheduler(db);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      console.log('\n[prober] 收到退出信号，SQLite WAL 会保证状态完整。再见。');
      process.exit(0);
    });
  }
  void scheduler.runForever();
  // 心跳兜底显示（scheduler 每 tick 更新真实心跳）
  void getSetting(db, 'prober_heartbeat_at');
}
