import { NextResponse } from 'next/server';
import { getDb, getRouterSuggestion } from '@gauge/shared';
import type { TaskType } from '@gauge/shared';

export const dynamic = 'force-dynamic';

const VALID: TaskType[] = ['vision', 'text', 'longcontext', 'function'];

export async function GET(req: Request) {
  const task = new URL(req.url).searchParams.get('task') ?? 'text';
  if (!VALID.includes(task as TaskType)) {
    return NextResponse.json({ error: 'invalid task' }, { status: 400 });
  }
  const db = getDb();
  return NextResponse.json(getRouterSuggestion(db, task as TaskType));
}
