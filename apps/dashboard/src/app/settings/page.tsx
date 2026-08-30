import { SettingsForm } from '@/components/SettingsForm';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">设置</h1>
        <p className="text-xs text-ink-soft">探测预算 / 分层间隔 / 并发 / 网关地址与 key</p>
      </div>
      <SettingsForm />
    </div>
  );
}
