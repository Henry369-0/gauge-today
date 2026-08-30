import { NextResponse } from 'next/server';
import { getDb, setSetting } from '@gauge/shared';

export const dynamic = 'force-dynamic';

/** POST /api/discover —— 请求 prober 在下一个 tick 重新拉取 /v1/models（SQLite 轻量 IPC） */
export async function POST() {
  const db = getDb();
  setSetting(db, 'discover_requested', '1');
  return NextResponse.json({ ok: true, note: 'prober 将在 2 秒内重新发现端点' });
}
