// 运行配置：settings 表是唯一事实来源（dashboard 设置页可热改，prober 每 tick 重读）。
// 环境变量 GAUGE_BASE_URL / GAUGE_API_KEY 只作为首次种子（见 shared/db.ts）。

import type { DatabaseSync } from 'node:sqlite';
import { getSettings, numSetting } from '@gauge/shared';

export interface ProberConfig {
  baseUrl: string;
  apiKey: string;
  budgetDaily: number;
  intervalCommonSec: number;
  intervalLongtailSec: number;
  intervalCorpseSec: number;
  concurrency: number;
  timeoutMs: number;
  rateLimitBackoff: number;
  keepProbesDays: number;
}

export function loadConfig(db: DatabaseSync): ProberConfig {
  const s = getSettings(db);
  return {
    baseUrl: s.base_url!.replace(/\/+$/, ''),
    apiKey: s.api_key ?? '',
    budgetDaily: numSetting(s, 'budget_daily'),
    intervalCommonSec: numSetting(s, 'interval_common_sec'),
    intervalLongtailSec: numSetting(s, 'interval_longtail_sec'),
    intervalCorpseSec: numSetting(s, 'interval_corpse_sec'),
    concurrency: numSetting(s, 'concurrency'),
    timeoutMs: numSetting(s, 'timeout_ms'),
    rateLimitBackoff: numSetting(s, 'rate_limit_backoff'),
    keepProbesDays: numSetting(s, 'keep_probes_days'),
  };
}

export function intervalSecFor(cfg: ProberConfig, tier: string): number {
  if (tier === 'common') return cfg.intervalCommonSec;
  if (tier === 'corpse') return cfg.intervalCorpseSec;
  return cfg.intervalLongtailSec;
}
