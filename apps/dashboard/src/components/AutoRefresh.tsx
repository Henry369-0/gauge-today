'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [last, setLast] = useState('');

  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => {
      router.refresh();
      setLast(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [on, seconds, router]);

  return (
    <button onClick={() => setOn(!on)} className="btn px-2 py-1 text-[11px] text-ink-soft">
      自动刷新 {on ? '开' : '关'}
      {on && last && <span className="ml-1 tnum text-ink-faint">{last}</span>}
    </button>
  );
}
