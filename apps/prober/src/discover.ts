// 端点发现（开发文档 §6 伴生基线）：唯一依赖上游的两个公开契约之一
// —— GET {base}/v1/models（OpenAI 标准）。上游内部怎么改版都不影响这里。

import type { DatabaseSync } from 'node:sqlite';
import { setSetting } from '@gauge/shared';
import type { ProberConfig } from './config.js';

interface RawModel {
  id: string;
  owned_by?: string;
  owned_by_org?: string;
  provider?: string;
}

export interface DiscoverResult {
  discovered: number;
  added: number;
  disabled: number;
  providers: number;
}

/** 供应商解析三级兜底：显式字段 → id 的 provider/ 前缀 → other（RECON_NOTES §2） */
export function providerOf(raw: RawModel): string {
  const explicit = raw.provider || raw.owned_by || raw.owned_by_org;
  if (explicit && !/^(system|openai|organization-owner|user-)/i.test(explicit)) return slug(explicit);
  const slash = raw.id.indexOf('/');
  if (slash > 0) return slug(raw.id.slice(0, slash));
  return 'other';
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'other';
}

export function prettyProvider(id: string): string {
  const known: Record<string, string> = {
    groq: 'Groq', cerebras: 'Cerebras', google: 'Google AI Studio', mistral: 'Mistral',
    openrouter: 'OpenRouter', cloudflare: 'Cloudflare', cohere: 'Cohere', zai: 'Z.ai',
    'z-ai': 'Z.ai', nvidia: 'NVIDIA', huggingface: 'HuggingFace', modelscope: 'ModelScope',
    'google-vertex': 'Google Vertex', 'google-ai-studio': 'Google AI Studio',
    github: 'GitHub Models', together: 'Together', deepinfra: 'DeepInfra', fireworks: 'Fireworks',
    hyperbolic: 'Hyperbolic', novita: 'Novita', sambacloud: 'SambaCloud', upstage: 'Upstage',
    ollama: 'Ollama', lmstudio: 'LM Studio', 'llama-cpp': 'llama.cpp', vllm: 'vLLM',
    other: '其他 / 未分组',
  };
  if (known[id]) return known[id];
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- 任务类型启发式标签 ----------
// 仅用于筛选便利，不构成能力保证（README 有说明）。text 是默认能力不标记。

export function inferTaskTypes(modelId: string): string[] {
  const m = modelId.toLowerCase();
  const tags: string[] = [];
  if (
    /vision|vl[-_]|[-_.]vl\b|omni|multimodal|pixtral|internvl|llava|idefics|molmo|qvq|glm-4v|gpt-4o|gpt-4\.1|gpt-5|gemini|claude-[3-9]|llama-[34]|gemma-[3-9]|mistral-(medium|large)/.test(
      m,
    )
  )
    tags.push('vision');
  if (
    /(^|[^a-z0-9])(1m|128k|200k|256k|400k|512k)([^a-z0-9]|$)|gemini-[0-9.]+-pro|long-?context/.test(
      m,
    )
  )
    tags.push('longcontext');
  if (
    /function|[-_]fc\b|tool|gpt-[45]|claude|gemini|qwen|deepseek|llama-[34]|mistral-(large|medium|small)|glm-[0-9]|kimi|grok|command-r|moonshot|hunyuan|doubao|ernie/.test(
      m,
    )
  )
    tags.push('function');
  return tags;
}

/** 全量重发现：新模型入库（长尾层），消失的端点 enabled=0（保留探测历史），用户已有状态一律不动 */
export async function discover(db: DatabaseSync, cfg: ProberConfig): Promise<DiscoverResult> {
  const res = await fetch(`${cfg.baseUrl}/v1/models`, {
    headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`/v1/models 返回 ${res.status}（检查网关地址与统一 key）`);
  const body = (await res.json()) as { data?: RawModel[] } | RawModel[];
  const list = Array.isArray(body) ? body : (body.data ?? []);
  if (!Array.isArray(list) || list.length === 0)
    throw new Error('/v1/models 未返回任何模型（网关还没完成目录同步？）');

  const now = Date.now();
  const providerIds = new Set<string>();

  const insProvider = db.prepare('INSERT OR IGNORE INTO providers(id, name, status) VALUES(?, ?, ?)');
  const insModel = db.prepare(
    `INSERT OR IGNORE INTO models(id, provider_id, model_name, tier, enabled, status, task_types)
     VALUES(?, ?, ?, 'longtail', 1, 'unknown', ?)`,
  );
  const touchModel = db.prepare(
    'UPDATE models SET enabled = 1, provider_id = ?, model_name = ?, task_types = ? WHERE id = ?',
  );

  let added = 0;
  for (const raw of list) {
    if (!raw?.id) continue;
    const pid = providerOf(raw);
    providerIds.add(pid);
    insProvider.run(pid, prettyProvider(pid), 'unknown');
    const taskTypes = inferTaskTypes(raw.id).join(' ');
    // 已存在的模型：只碰"清单归属"，用户的层级/星标/防抖状态一律不动
    const r = insModel.run(raw.id, pid, raw.id, taskTypes);
    if (r.changes === 0) touchModel.run(pid, raw.id, taskTypes, raw.id);
    else added++;
  }

  // 本次没看到的端点 → 停用（不删，历史还在）
  const allIds = list.map((m) => m?.id).filter(Boolean) as string[];
  const idSet = new Set(allIds);
  const existing = db.prepare('SELECT id FROM models WHERE enabled = 1').all() as unknown as { id: string }[];
  const disable = db.prepare('UPDATE models SET enabled = 0 WHERE id = ?');
  let disabled = 0;
  for (const row of existing) {
    if (!idSet.has(row.id)) {
      disable.run(row.id);
      disabled++;
    }
  }

  setSetting(db, 'last_discovery_at', String(now));
  setSetting(db, 'last_discovery_json', JSON.stringify({ ts: now, count: list.length, base_url: cfg.baseUrl }));
  return { discovered: list.length, added, disabled, providers: providerIds.size };
}
