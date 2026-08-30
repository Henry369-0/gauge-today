// 分层调度器（开发文档 §5）：setTimeout 自调度，不引 cron 库。
//   常用层 5min / 长尾层 30min / 尸体层 2h，±20% 抖动，并发池 5，每日预算上限。
//   429 额外降频 rate_limit_backoff 倍；预算耗尽只放行常用层。

import type { DatabaseSync } from 'node:sqlite';
import {
  applyProbeResult,
  getSetting,
  recordGatewaySignal,
  setSetting,
  startOfLocalDay,
} from '@gauge/shared';
import type { ProbeOutcome } from '@gauge/shared';
import { loadConfig, intervalSecFor, type ProberConfig } from './config.js';
import { discover } from './discover.js';
import { probeModel } from './probe.js';

const TICK_MS = 2_000;
const REDISCOVER_AFTER_MS = 12 * 3600_000;
const BOOT_DISCOVER_RETRY_MS = 30_000; // 首次发现成功前 30s 重试（网关可能比 prober 晚起）
const NETWORK_ERROR_BACKOFF_MS = 60_000;
const NETWORK_ERROR_CIRCUIT_BREAK = 60_000; // 连续 5 次网关不可达 → 暂停 60s

interface DueModel {
  id: string;
  tier: string;
  due: number;
}

export class Scheduler {
  private nextDue = new Map<string, number>();
  private running = 0;
  private consecutiveNetworkErrors = 0;
  private pausedUntil = 0;
  private booted = false;
  private discoveredOnce = false;

  constructor(private db: DatabaseSync) {}

  async runForever(): Promise<void> {
    // 启动即重发现（§11：每次启动重新拉清单）；失败不阻塞，10 分钟后重试
    await this.maybeDiscover(true);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await this.tick();
      } catch (err) {
        console.error('[scheduler] tick 异常:', err);
      }
      await new Promise((r) => setTimeout(r, TICK_MS));
    }
  }

  private async maybeDiscover(force = false): Promise<void> {
    const cfg = loadConfig(this.db);
    const last = Number(getSetting(this.db, 'last_discovery_at') || 0);
    const lastAttempt = Number(getSetting(this.db, 'last_discover_attempt_at') || 0);
    if (this.discoveredOnce && !force && Date.now() - last < REDISCOVER_AFTER_MS) return;
    const minGap = this.discoveredOnce ? 10 * 60_000 : BOOT_DISCOVER_RETRY_MS;
    if (Date.now() - lastAttempt < minGap) return;
    setSetting(this.db, 'last_discover_attempt_at', String(Date.now()));
    try {
      const result = await discover(this.db, cfg);
      this.discoveredOnce = true;
      console.log(
        `[discover] 端点 ${result.discovered} · 新增 ${result.added} · 停用 ${result.disabled} · 供应商 ${result.providers}`,
      );
      this.initNextDueForNewcomers();
    } catch (err) {
      console.warn('[discover] 失败（将用已有清单继续，稍后重试）:', (err as Error).message);
    }
  }

  /** 新入库端点首次排程：在 0.2×interval 内随机铺开，避免启动风暴 */
  private initNextDueForNewcomers(): void {
    const cfg = loadConfig(this.db);
    const rows = this.db
      .prepare('SELECT id, tier, last_checked_at FROM models WHERE enabled = 1')
      .all() as unknown as { id: string; tier: string; last_checked_at: number | null }[];
    const now = Date.now();
    for (const r of rows) {
      if (this.nextDue.has(r.id)) continue;
      if (!r.last_checked_at) {
        const interval = intervalSecFor(cfg, r.tier) * 1000;
        this.nextDue.set(r.id, now + Math.random() * interval * 0.2);
      } else {
        this.nextDue.set(r.id, this.computeNextDue(cfg, r.tier, null, r.last_checked_at));
      }
    }
    this.booted = true;
  }

  /** 错峰抖动 ±20%（§5）；429 追加降频倍数 */
  private computeNextDue(
    cfg: ProberConfig,
    tier: string,
    outcome: ProbeOutcome | null,
    fromTs = Date.now(),
  ): number {
    const jitter = 0.9 + Math.random() * 0.2;
    let ms = intervalSecFor(cfg, tier) * 1000 * jitter;
    if (outcome && !outcome.ok && outcome.error_class === 'rate_limited')
      ms *= cfg.rateLimitBackoff;
    return fromTs + ms;
  }

  private probesToday(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM probes WHERE ts >= ?')
      .get(startOfLocalDay(Date.now())) as unknown as { n: number };
    return row.n;
  }

  private async tick(): Promise<void> {
    const cfg = loadConfig(this.db);
    setSetting(this.db, 'prober_heartbeat_at', String(Date.now()));

    if (!this.booted) this.initNextDueForNewcomers();

    // dashboard 设置页的"重新发现"信号（走 SQLite 的轻量 IPC）
    if (getSetting(this.db, 'discover_requested') === '1') {
      setSetting(this.db, 'discover_requested', '0');
      await this.maybeDiscover(true);
    }

    await this.maybeDiscover(false);
    this.maybeCleanup(cfg);

    if (Date.now() < this.pausedUntil) return;

    const used = this.probesToday();
    const remaining = cfg.budgetDaily - used;

    const now = Date.now();
    const due: DueModel[] = [];
    for (const [id, ts] of this.nextDue) {
      if (ts <= now) due.push({ id, tier: this.tierOf(id), due: ts });
    }
    const tierRank = (t: string) => (t === 'common' ? 0 : t === 'longtail' ? 1 : 2);
    due.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.due - b.due);

    for (const m of due) {
      if (this.running >= cfg.concurrency) break;
      // §5：预算耗尽只放行常用层（"耗尽则本轮跳过低优先级"）
      if (remaining <= 0 && m.tier !== 'common') continue;
      this.running++;
      void this.probeOne(m.id, m.tier, cfg);
    }
  }

  private tierStmt: ReturnType<DatabaseSync['prepare']> | null = null;
  private tierOf(id: string): string {
    this.tierStmt ??= this.db.prepare('SELECT tier FROM models WHERE id = ?');
    const row = this.tierStmt.get(id) as unknown as { tier: string } | undefined;
    return row?.tier ?? 'longtail';
  }

  private async probeOne(modelId: string, tier: string, cfg: ProberConfig): Promise<void> {
    try {
      const outcome = await probeModel(cfg, modelId);

      if (outcome.error_class === 'network_error') {
        // 网关进程不可达：不落 probes、不推进防抖，只记录网关信号 + 退避
        recordGatewaySignal(this.db, false);
        this.consecutiveNetworkErrors++;
        if (this.consecutiveNetworkErrors >= 5) {
          this.pausedUntil = Date.now() + NETWORK_ERROR_CIRCUIT_BREAK;
          this.consecutiveNetworkErrors = 0;
          console.warn('[probe] 网关连续不可达，暂停探测 60s');
        }
        this.nextDue.set(modelId, Date.now() + NETWORK_ERROR_BACKOFF_MS);
        return;
      }
      recordGatewaySignal(this.db, true);

      this.db
        .prepare('INSERT INTO probes(model_id, ts, ok, latency_ms, error_class) VALUES(?, ?, ?, ?, ?)')
        .run(
          modelId,
          Date.now(),
          outcome.ok ? 1 : 0,
          outcome.latency_ms,
          outcome.error_class,
        );
      applyProbeResult(this.db, modelId, outcome);
      // 探测后重读 tier：尸体降级/恢复可能在本次探测里发生
      this.nextDue.set(modelId, this.computeNextDue(loadConfig(this.db), this.tierOf(modelId), outcome));

      if (!outcome.ok && outcome.error_class !== 'rate_limited') {
        console.warn(`[probe] ${modelId} → ${outcome.error_class}（${outcome.error_message}）`);
      }
    } catch (err) {
      console.error(`[probe] ${modelId} 探测器异常:`, err);
      this.nextDue.set(modelId, Date.now() + 300_000);
    } finally {
      this.running--;
    }
  }

  /** probes 保留 14 天（可配），每日清理一次；顺带清孤儿 */
  private maybeCleanup(cfg: ProberConfig): void {
    const today = new Date().toISOString().slice(0, 10);
    if (getSetting(this.db, 'last_cleanup_day') === today) return;
    const cutoff = Date.now() - cfg.keepProbesDays * 86400_000;
    const r1 = this.db.prepare('DELETE FROM probes WHERE ts < ?').run(cutoff);
    const r2 = this.db
      .prepare('DELETE FROM probes WHERE model_id NOT IN (SELECT id FROM models)')
      .run();
    setSetting(this.db, 'last_cleanup_day', today);
    console.log(`[cleanup] 清理过期探测 ${r1.changes} 条 · 孤儿 ${r2.changes} 条`);
  }
}
