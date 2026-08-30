import { NextResponse } from 'next/server';
import { getDb, getOverview } from '@gauge/shared';

export const dynamic = 'force-dynamic';

/** GET /api/stats —— 总览 JSON。给 #03/#05/#07 做状态小挂件轮询用（系列联动） */
export async function GET() {
  const db = getDb();
  return NextResponse.json(getOverview(db));
}
