import { NextResponse } from 'next/server';
import { getDb } from '@gauge/shared';

export const dynamic = 'force-dynamic';

/** POST /api/models/star { model_id, star: boolean } —— 标记/取消"常用"层（§5 分层调度） */
export async function POST(req: Request) {
  const body = (await req.json()) as { model_id?: string; star?: boolean };
  if (!body.model_id) return NextResponse.json({ error: 'model_id required' }, { status: 400 });
  const db = getDb();
  const info = db
    .prepare('UPDATE models SET tier = ?, starred_at = ? WHERE id = ?')
    .run(body.star ? 'common' : 'longtail', body.star ? Date.now() : null, body.model_id);
  if (info.changes === 0) return NextResponse.json({ error: 'model not found' }, { status: 404 });
  return NextResponse.json({ ok: true, model_id: body.model_id, tier: body.star ? 'common' : 'longtail' });
}
