'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: '总览' },
  { href: '/wall', label: '健康墙' },
  { href: '/models', label: '模型浏览器' },
  { href: '/router', label: '路由建议器' },
  { href: '/settings', label: '设置' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-ink/70 bg-paper/95 backdrop-blur sticky top-0 z-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight">gauge.today</span>
            <span className="text-xs text-ink-soft">免费仪表盘 · freellmapi 控制台</span>
          </Link>
          <span className="hidden md:inline-block ml-auto text-[11px] text-ink-faint">
            34 家供应商 · 635 个免费端点 · 只有真实请求算数
          </span>
        </div>
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((t) => {
            const active = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={
                  'px-3 py-2 text-sm whitespace-nowrap border border-b-0 -mb-px transition-colors ' +
                  (active
                    ? 'bg-ink text-paper border-ink'
                    : 'bg-paper-card text-ink-soft border-ink/25 hover:text-ink')
                }
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
