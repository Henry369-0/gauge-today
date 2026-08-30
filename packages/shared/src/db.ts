// SQLite 访问层 · WAL 模式（prober 单写者 + dashboard 读互不阻塞，开发文档 §3/§11）
//
// 为什么是 node:sqlite 而不是文档写的 better-sqlite3：
// Node 24 内置 node:sqlite，API 同为同步 prepare/run/get/all，行为等价，
// 省掉 Windows / 树莓派上的 node-gyp 原生编译——自托管"零编译"。
// 封装收口在本文件，将来要换 better-sqlite3 只动这里（RECON_NOTES §5）。

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

let _db: DatabaseSync | null = null;

/** 解析 SQLite 文件路径：GAUGE_DB_PATH > 逐级向上找 data/gauge.db > <monorepo>/data/gauge.db */
export function resolveDbPath(): string {
  if (process.env.GAUGE_DB_PATH) return path.resolve(process.env.GAUGE_DB_PATH);
  const candidates = [
    path.resolve(process.cwd(), 'data', 'gauge.db'),
    path.resolve(process.cwd(), '../../data/gauge.db'),
    path.resolve(process.cwd(), '../../../data/gauge.db'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[1]!;
}

export function getDb(): DatabaseSync {
  if (_db) return _db;
  const file = resolveDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  _db = new DatabaseSync(file);
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec('PRAGMA busy_timeout = 5000;');
  _db.exec('PRAGMA synchronous = NORMAL;');
  migrate(_db);
  return _db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'unknown',
      last_checked_at INTEGER
    );

    -- 防抖状态机的计数器直接落库：prober 重启后状态不重置（M4 验收项）
    CREATE TABLE IF NOT EXISTS models (
      id                 TEXT PRIMARY KEY,
      provider_id        TEXT NOT NULL REFERENCES providers(id),
      model_name         TEXT NOT NULL,
      tier               TEXT NOT NULL DEFAULT 'longtail',
      enabled            INTEGER NOT NULL DEFAULT 1,
      status             TEXT NOT NULL DEFAULT 'unknown',
      consecutive_fails  INTEGER NOT NULL DEFAULT 0,
      consecutive_oks    INTEGER NOT NULL DEFAULT 0,
      last_error_class   TEXT,
      last_error_message TEXT,
      last_ok_at         INTEGER,
      last_checked_at    INTEGER,
      down_since         INTEGER,
      task_types         TEXT NOT NULL DEFAULT '',
      starred_at         INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);
    CREATE INDEX IF NOT EXISTS idx_models_status ON models(status);

    -- probes 是唯一大表：预算 3000/日 × 14 天 ≈ 4.2 万行，SQLite 毫无压力（§8）
    CREATE TABLE IF NOT EXISTS probes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id    TEXT NOT NULL,
      ts          INTEGER NOT NULL,
      ok          INTEGER NOT NULL,
      latency_ms  INTEGER,
      error_class TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_probes_model_ts ON probes(model_id, ts);
    CREATE INDEX IF NOT EXISTS idx_probes_ts ON probes(ts);

    CREATE TABLE IF NOT EXISTS fallback_chains (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      task_type  TEXT,
      steps_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// ---------- settings ----------

export const SETTING_DEFAULTS: Record<string, string> = {
  base_url: 'http://localhost:3001', // freellmapi 网关地址
  api_key: '', // 统一 bearer token（freellmapi-…）
  budget_daily: '3000', // §5 每日探测预算
  interval_common_sec: '300', // 常用层 5min
  interval_longtail_sec: '1800', // 长尾层 30min
  interval_corpse_sec: '7200', // 尸体层 2h
  concurrency: '5', // §5 并发池
  timeout_ms: '15000', // §4 超时线
  rate_limit_backoff: '3', // 429 时该端点额外降频倍数
  keep_probes_days: '14', // probes 保留天数
  discover_requested: '0', // dashboard → prober 的"重新发现"信号（SQLite IPC）
  prober_heartbeat_at: '0', // prober 每 tick 更新，dashboard 据此判断存活
};

export function getSetting(db: DatabaseSync, key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (row) return row.value;
  // 首次读取时允许环境变量做种子（README：GAUGE_BASE_URL / GAUGE_API_KEY）
  if (key === 'base_url' && process.env.GAUGE_BASE_URL) {
    setSetting(db, key, process.env.GAUGE_BASE_URL);
    return process.env.GAUGE_BASE_URL;
  }
  if (key === 'api_key' && process.env.GAUGE_API_KEY) {
    setSetting(db, key, process.env.GAUGE_API_KEY);
    return process.env.GAUGE_API_KEY;
  }
  return SETTING_DEFAULTS[key] ?? '';
}

export function getSettings(db: DatabaseSync): Record<string, string> {
  const out: Record<string, string> = { ...SETTING_DEFAULTS };
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  for (const r of rows) out[r.key] = r.value;
  // 环境变量种子（仅当表里还没显式写过该键）
  if (!rows.some((r) => r.key === 'base_url') && process.env.GAUGE_BASE_URL)
    out.base_url = process.env.GAUGE_BASE_URL;
  if (!rows.some((r) => r.key === 'api_key') && process.env.GAUGE_API_KEY)
    out.api_key = process.env.GAUGE_API_KEY;
  return out;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function numSetting(settings: Record<string, string>, key: string): number {
  const n = Number(settings[key]);
  return Number.isFinite(n) && n > 0 ? n : Number(SETTING_DEFAULTS[key]);
}
