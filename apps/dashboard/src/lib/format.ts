// 展示层小工具：毫秒、百分比、相对时间

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function fmtPct(ratio: number | null | undefined, digits = 0): string {
  if (ratio == null) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return '从未';
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))} 秒前`;
  if (diff < 3600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.round(diff / 3600_000)} 小时前`;
  return `${Math.round(diff / 86400_000)} 天前`;
}

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}
