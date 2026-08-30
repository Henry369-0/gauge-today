// 术语与开发文档 §4/§8 对齐。shared 是 prober 与 dashboard 的唯一类型来源。
// 标签常量（错误分类/层级/任务类型的中文文案）在 ./labels —— 客户端专用出口。

/** 错误分类学（§4 五类 + network_error，见 RECON_NOTES §5.2） */
export type ErrorClass =
  | 'rate_limited' // 429，免费额度/频率限制 → 黄，降频
  | 'auth_failed' //  401/403，key 失效 → 红
  | 'upstream_error' // 5xx，上游供应商挂了 → 红
  | 'timeout' //      >15s，慢死 → 红
  | 'empty_response' // 200 但没内容，最常见的"假活" → 红
  | 'network_error'; // 网关进程本身不可达 → 不算任何端点的失败，仪表盘顶部横幅

/** 端点层级（§5 分层调度）：常用 5min / 长尾 30min / 尸体 2h */
export type Tier = 'common' | 'longtail' | 'corpse';

/** 防抖状态机（§4）：连续 2 失败判 down，恢复需连续 2 成功；429 单次即黄 */
export type EndpointStatus = 'up' | 'degraded' | 'down' | 'unknown';

/** 任务类型标签（启发式，discover 时从模型名推断） */
export type TaskType = 'vision' | 'text' | 'longcontext' | 'function';

/** 一条探测记录（probes 表一行） */
export interface ProbeRecord {
  model_id: string;
  ts: number; // epoch ms
  ok: boolean;
  latency_ms: number | null;
  error_class: ErrorClass | null;
}

export interface ModelRow {
  id: string;
  provider_id: string;
  model_name: string;
  tier: Tier;
  enabled: boolean;
  status: EndpointStatus;
  consecutive_fails: number;
  consecutive_oks: number;
  last_error_class: ErrorClass | null;
  last_error_message: string | null;
  last_ok_at: number | null;
  last_checked_at: number | null;
  down_since: number | null;
  task_types: string; // 空格分隔的 TaskType
  starred_at: number | null;
}

export interface ProviderRow {
  id: string;
  name: string;
  status: EndpointStatus;
  last_checked_at: number | null;
}

/** 模型浏览器一行（models 表 + 24h 延迟与 7 日条带聚合） */
export interface ModelView extends ModelRow {
  provider_name: string;
  p50_ms: number | null;
  p95_ms: number | null;
  samples_24h: number;
  /** 最近 7 天每日 uptime 比例，旧→新；null = 当日无探测 */
  strip: (number | null)[];
}

/** 健康墙一张供应商卡 */
export interface ProviderCard {
  id: string;
  name: string;
  status: EndpointStatus;
  total: number;
  up: number;
  degraded: number;
  down: number;
  last_checked_at: number | null;
  /** 供应商维度 24h 延迟 sparkline（按小时取中位 ok 延迟），旧→新 */
  spark: (number | null)[];
  /** 供应商维度 7 日 uptime 条带 */
  strip: (number | null)[];
}

/** 总览页四卡 + 时间线 */
export interface Overview {
  gateway_up: boolean;
  total_enabled: number;
  up_count: number;
  degraded_count: number;
  down_count: number;
  unknown_count: number;
  budget_daily: number;
  budget_used_today: number;
  failures_today: number;
  p50_ms: number | null;
  p50_window_label: string;
  prober_heartbeat_at: number | null;
  prober_alive: boolean;
  timeline24h: { label: string; hour: number; oks: number; fails: number }[];
}

/** 路由建议器 Top 条目 */
export interface RouterCandidate {
  model_id: string;
  provider_id: string;
  status: EndpointStatus;
  p50_ms: number | null;
  samples: number;
  uptime_24h: number | null;
}

export interface RouterSuggestion {
  task_type: TaskType;
  generated_at: number;
  window_label: string;
  chain: RouterCandidate[];
}
