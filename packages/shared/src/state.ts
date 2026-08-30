// 防抖状态机（开发文档 §4）：连续 2 次失败才判 down，恢复需连续 2 次成功。
// 状态直接落库到 models 表，prober 重启不重置（M4 验收项）。
// 429 特殊：单次即 degraded（黄），不计入失败连击——"额度耗尽"不是"死了"。

import type { DatabaseSync } from 'node:sqlite';
import type { ErrorClass, EndpointStatus, Tier } from './types';
import { setSetting } from './db';

export interface ProbeOutcome {
  ok: boolean;
  latency_ms: number | null;
  error_class: ErrorClass | null;
  error_message: string | null;
}

/** 尸体判定线：连续 down 超过 3 天 → tier 降到 corpse（§5"尸体不插旗"） */
export const CORPSE_AFTER_MS = 3 * 86400_000;

export function applyProbeResult(db: DatabaseSync, modelId: string, outcome: ProbeOutcome): void {
  const row = db
    .prepare('SELECT provider_id, status, tier, consecutive_fails, consecutive_oks, down_since FROM models WHERE id = ?')
    .get(modelId) as
    | { provider_id: string; status: EndpointStatus; tier: Tier; consecutive_fails: number; consecutive_oks: number; down_since: number | null }
    | undefined;
  if (!row) return;

  const now = Date.now();
  let status = row.status;
  let consecutiveFails = row.consecutive_fails;
  let consecutiveOks = row.consecutive_oks;
  let downSince = row.down_since;
  const tier = row.tier;

  if (outcome.ok) {
    consecutiveOks++;
    consecutiveFails = 0;
    if (status === 'down' && consecutiveOks >= 2) status = 'up';
    else if (status === 'degraded' || status === 'unknown') status = 'up';
  } else if (outcome.error_class === 'rate_limited') {
    // 429：黄 + 计入降频，但不算失败连击
    consecutiveOks = 0;
    status = 'degraded';
  } else {
    consecutiveOks = 0;
    consecutiveFails++;
    if (status !== 'down' && consecutiveFails >= 2) {
      status = 'down';
      downSince = now;
    }
  }

  // 恢复即出坟；非常用层连 down 3 天 → 降为尸体层（常用层尊重用户标记，不自动降）
  let tierOut = tier;
  if (status === 'up' || status === 'degraded') {
    downSince = null;
    if (tierOut === 'corpse') tierOut = 'longtail';
  } else if (status === 'down' && downSince && tier !== 'common') {
    if (now - downSince > CORPSE_AFTER_MS) tierOut = 'corpse';
  }

  db.prepare(
    `UPDATE models SET
       status = ?, consecutive_fails = ?, consecutive_oks = ?,
       last_error_class = ?, last_error_message = ?,
       last_ok_at = CASE WHEN ? = 1 THEN ? ELSE last_ok_at END,
       last_checked_at = ?, down_since = ?, tier = ?
     WHERE id = ?`,
  ).run(
    status,
    consecutiveFails,
    consecutiveOks,
    outcome.error_class,
    outcome.error_message,
    outcome.ok ? 1 : 0,
    now,
    now,
    downSince,
    tierOut,
    modelId,
  );

  refreshProviderStatus(db, row.provider_id);
}

/** 供应商状态 = 其下启用端点聚合：任一 up → up，否则任一 degraded → degraded，否则全 down → down */
export function refreshProviderStatus(db: DatabaseSync, providerId: string): void {
  const agg = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) AS up,
         SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) AS degraded,
         SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) AS down
       FROM models WHERE enabled = 1 AND provider_id = ?`,
    )
    .get(providerId) as unknown as { up: number; degraded: number; down: number } | undefined;
  const status: EndpointStatus = !agg
    ? 'unknown'
    : agg.up > 0
      ? 'up'
      : agg.degraded > 0
        ? 'degraded'
        : agg.down > 0
          ? 'down'
          : 'unknown';
  db.prepare('UPDATE providers SET status = ?, last_checked_at = ? WHERE id = ?').run(
    status,
    Date.now(),
    providerId,
  );
}

/** 网关级存活信号：network_error 不落 probes、不推进防抖，只点亮横幅 */
export function recordGatewaySignal(db: DatabaseSync, ok: boolean): void {
  setSetting(db, ok ? 'gateway_ok_at' : 'gateway_err_at', String(Date.now()));
}
