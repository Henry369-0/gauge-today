import { getDb, getModelViews, getProviderOptions } from '@gauge/shared';
import { ModelBrowser } from '@/components/ModelBrowser';

export const dynamic = 'force-dynamic';

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string }>;
}) {
  const { provider } = await searchParams;
  const db = getDb();
  const models = getModelViews(db, {});
  const providers = getProviderOptions(db);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">模型浏览器</h1>
        <p className="text-xs text-ink-soft">全部端点一览：状态 / 延迟 / 层级，可筛可排可标星</p>
      </div>
      <ModelBrowser models={models} providers={providers} initialProvider={provider ?? ''} />
    </div>
  );
}
