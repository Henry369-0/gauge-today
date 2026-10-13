import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { getDb, setSetting } from '@gauge/shared';
import { Scheduler } from './scheduler.js';

const tempRoot = path.resolve(os.tmpdir());
const testDir = fs.mkdtempSync(path.join(tempRoot, 'gauge-scheduler-test-'));
process.env.GAUGE_DB_PATH = path.join(testDir, 'gauge.db');
const db = getDb();

type Pending = { modelId: string; resolve(response: Response): void; reject(error: Error): void };
let pending: Pending[] = [];
let requests: string[] = [];
let now = 0;

beforeEach(() => {
  mock.reset();
  pending = [];
  requests = [];
  now = new Date('2026-10-13T08:00:00Z').getTime();
  mock.method(Date, 'now', () => now);
  db.exec('DELETE FROM probes; DELETE FROM models; DELETE FROM providers; DELETE FROM settings;');
  db.prepare('INSERT INTO providers(id, name) VALUES(?, ?)').run('test', 'Test');
  setSetting(db, 'budget_daily', '100');
  setSetting(db, 'concurrency', '5');
  setSetting(db, 'last_discovery_at', String(now));
  setSetting(db, 'last_discover_attempt_at', String(now));
  setSetting(db, 'last_cleanup_day', new Date(now).toISOString().slice(0, 10));
  mock.method(globalThis, 'fetch', async (...args: Parameters<typeof fetch>) => {
    const modelId = (JSON.parse(String(args[1]?.body)) as { model: string }).model;
    requests.push(modelId);
    return new Promise<Response>((resolve, reject) => pending.push({ modelId, resolve, reject }));
  });
});

async function flush() {
  await new Promise<void>(resolve => setImmediate(resolve));
}

function succeed(request: Pending) {
  request.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }));
}

afterEach(async () => {
  for (const request of pending) succeed(request);
  await flush();
  mock.reset();
});

after(() => {
  db.close();
  const resolved = path.resolve(testDir);
  assert.ok(resolved.startsWith(tempRoot + path.sep));
  assert.ok(path.basename(resolved).startsWith('gauge-scheduler-test-'));
  fs.rmSync(resolved, { recursive: true, force: true });
});

function fixture(models: Array<{ id: string; tier?: string }>, probesToday = 0) {
  const scheduler = new Scheduler(db) as unknown as {
    booted: boolean;
    discoveredOnce: boolean;
    nextDue: Map<string, number>;
    tick(): Promise<void>;
  };
  scheduler.booted = true;
  scheduler.discoveredOnce = true;
  const insertModel = db.prepare('INSERT INTO models(id, provider_id, model_name, tier) VALUES(?, ?, ?, ?)');
  for (const model of models) {
    insertModel.run(model.id, 'test', model.id, model.tier ?? 'longtail');
    scheduler.nextDue.set(model.id, now - 1);
  }
  const insertProbe = db.prepare('INSERT INTO probes(model_id, ts, ok, latency_ms) VALUES(?, ?, 1, 1)');
  for (let i = 0; i < probesToday; i++) insertProbe.run(models[0].id, now);
  return scheduler;
}

test('a slow endpoint has at most one probe in flight across scheduler ticks', async () => {
  const scheduler = fixture([{ id: 'test/slow' }]);
  await scheduler.tick();
  now += 2_000;
  await scheduler.tick();
  now += 2_000;
  await scheduler.tick();
  assert.deepEqual(requests, ['test/slow']);
});

test('only the remaining budget is dispatched when several longtail endpoints are due', async () => {
  const scheduler = fixture([{ id: 'test/a' }, { id: 'test/b' }, { id: 'test/c' }], 99);
  await scheduler.tick();
  assert.equal(requests.length, 1);
  succeed(pending[0]);
  await flush();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM probes').get() as { n: number }).n, 100);
});

test('an in-flight probe reserves the last budget slot for subsequent ticks', async () => {
  const scheduler = fixture([{ id: 'test/a' }, { id: 'test/b' }], 99);
  scheduler.nextDue.set('test/b', now + 1_000);
  await scheduler.tick();
  now += 2_000;
  await scheduler.tick();
  assert.deepEqual(requests, ['test/a']);
});

test('a completed probe releases its endpoint for the next scheduled check', async () => {
  const scheduler = fixture([{ id: 'test/slow' }]);
  await scheduler.tick();
  succeed(pending[0]);
  await flush();
  now += 2_000;
  await scheduler.tick();
  assert.equal(requests.length, 1);
  now += 2_000_000;
  await scheduler.tick();
  assert.equal(requests.length, 2);
});

test('a network failure releases the endpoint and unused budget after its backoff', async () => {
  const scheduler = fixture([{ id: 'test/a' }], 99);
  await scheduler.tick();
  pending[0].reject(new TypeError('fetch failed'));
  await flush();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM probes').get() as { n: number }).n, 99);
  now += 61_000;
  await scheduler.tick();
  assert.equal(requests.length, 2);
});

test('the documented common-tier exception continues after the budget is exhausted', async () => {
  const scheduler = fixture([{ id: 'test/longtail' }, { id: 'test/common', tier: 'common' }], 100);
  await scheduler.tick();
  assert.deepEqual(requests, ['test/common']);
});
