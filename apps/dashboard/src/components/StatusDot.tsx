import type { EndpointStatus } from '@gauge/shared/labels';

const STATUS_STYLE: Record<EndpointStatus, { dot: string; label: string; text: string }> = {
  up: { dot: 'bg-moss', label: '活', text: 'text-moss' },
  degraded: { dot: 'bg-mustard', label: '黄', text: 'text-mustard' },
  down: { dot: 'bg-brick', label: '挂', text: 'text-brick' },
  unknown: { dot: 'bg-ink-faint', label: '未知', text: 'text-ink-faint' },
};

export function StatusDot({ status, withLabel = true }: { status: EndpointStatus; withLabel?: boolean }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.unknown;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-2.5 rounded-full border border-ink/40 ${s.dot}`} />
      {withLabel && <span className={`text-xs ${s.text}`}>{s.label}</span>}
    </span>
  );
}

export function statusText(status: EndpointStatus): string {
  return (STATUS_STYLE[status] ?? STATUS_STYLE.unknown).label;
}

export function statusColorClass(status: EndpointStatus): string {
  return (STATUS_STYLE[status] ?? STATUS_STYLE.unknown).text;
}

/** 状态徽章（大一点，用于卡片角标） */
export function StatusBadge({ status }: { status: EndpointStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.unknown;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-ink/40 px-2 py-0.5 text-[11px] ${s.text}`}
    >
      <span className={`inline-block size-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
