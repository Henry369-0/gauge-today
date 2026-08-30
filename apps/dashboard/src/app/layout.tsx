import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: 'gauge.today · 免费仪表盘',
  description: 'freellmapi 聚合网关的健康墙：谁活着、谁快、额度还剩多少、挂了自动切谁。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <Nav />
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 sm:px-6 pb-8 pt-4 text-[11px] text-ink-faint">
          gauge.today · 自托管个人实验工具，不承诺 SLA · 上游 freellmapi (MIT) ·
          探测请求 max_tokens=1，不消耗免费生成额度
        </footer>
      </body>
    </html>
  );
}
