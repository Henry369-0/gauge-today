// 纯常量 + 类型出口（无 node:sqlite 依赖）：客户端组件从这里导入，
// 否则 webpack 会把整包（含 SQLite）打进浏览器 bundle。

import type { ErrorClass, TaskType, Tier } from './types';

export type {
  ErrorClass,
  Tier,
  EndpointStatus,
  TaskType,
  ProbeRecord,
  ModelRow,
  ProviderRow,
  ModelView,
  ProviderCard,
  Overview,
  RouterCandidate,
  RouterSuggestion,
} from './types';

export const ERROR_CLASS_LABEL: Record<ErrorClass, string> = {
  rate_limited: '限流 429',
  auth_failed: 'key 失效',
  upstream_error: '上游 5xx',
  timeout: '超时',
  empty_response: '空响应',
  network_error: '网关不可达',
};

export const TIER_LABEL: Record<Tier, string> = {
  common: '常用',
  longtail: '长尾',
  corpse: '尸体',
};

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  vision: '视觉',
  text: '文本',
  longcontext: '长上下文',
  function: '函数调用',
};
