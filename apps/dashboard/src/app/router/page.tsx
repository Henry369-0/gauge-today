import { RouterStudio } from '@/components/RouterStudio';

export const dynamic = 'force-dynamic';

export default function RouterPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">路由建议器</h1>
        <p className="text-xs text-ink-soft">
          选任务类型 → 按最近 2h 真实探测的 P50 排序取 Top3 → 生成 fallback 链
        </p>
      </div>
      <RouterStudio />
    </div>
  );
}
