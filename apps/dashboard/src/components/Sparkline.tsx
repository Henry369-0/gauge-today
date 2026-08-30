// 手写 SVG sparkline（开发文档 §3：数据量小，不值得引图表库）
// 输入：24 个小时桶的延迟中位数（null = 该小时无探测），旧 → 新

export function Sparkline({
  points,
  width = 132,
  height = 30,
  stroke = 'var(--color-moss)',
}: {
  points: (number | null)[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  const idx = points.map((p, i) => (p != null ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) {
    return (
      <svg width={width} height={height} aria-label="延迟 sparkline（无数据）">
        <line
          x1={2}
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke="rgba(43,43,38,0.18)"
          strokeDasharray="2 3"
        />
      </svg>
    );
  }
  const vals = idx.map((i) => points[i]!);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const pad = 4;
  const step = idx.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const pts = idx.map((i) => {
    const v = points[i]!;
    const x = pad + i * step;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} aria-label="24h 延迟 sparkline">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* 末点标记 */}
      <circle
        cx={pad + idx[idx.length - 1]! * step}
        cy={height - pad - ((vals[vals.length - 1]! - min) / range) * (height - pad * 2)}
        r={2.2}
        fill={stroke}
      />
    </svg>
  );
}
