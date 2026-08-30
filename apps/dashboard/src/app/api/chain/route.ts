import { NextResponse } from 'next/server';
import { getDb, saveFallbackChain } from '@gauge/shared';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as { task?: string; steps?: unknown; name?: string };
  const steps = Array.isArray(body.steps) ? body.steps.filter((s): s is string => typeof s === 'string') : [];
  if (steps.length === 0) return NextResponse.json({ error: 'empty chain' }, { status: 400 });
  const db = getDb();
  const name = body.name?.trim() || `fallback-${body.task ?? 'custom'}-${new Date().toISOString().slice(0, 10)}`;
  saveFallbackChain(db, name, body.task ?? 'custom', steps);
  const row = db
    .prepare('SELECT id FROM fallback_chains ORDER BY id DESC LIMIT 1')
    .get() as unknown as { id: number };
  return NextResponse.json({ id: row.id, name, steps });
}
