// 真实探测（开发文档 §4 灵魂洞察）：健康检查会说谎，只有真实请求算数。
// 探测 = POST /v1/chat/completions，内容 "hi"，max_tokens: 1。
//
// ⚠️ 探测请求不花 token：max_tokens 必须保持 1（§5）。
//    后来者请勿"顺手"改大——635 端点 × 5min 会把免费额度烧光。

import type { ProberConfig } from './config.js';
import type { ErrorClass } from '@gauge/shared';
import type { ProbeOutcome } from '@gauge/shared';

export async function probeModel(cfg: ProberConfig, modelId: string): Promise<ProbeOutcome> {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1, // ⚠️ 见文件头注释：保持 1，勿改大
      }),
      signal: ctrl.signal,
    });
    const latencyMs = Math.round(performance.now() - started);

    if (res.status === 429) return fail('rate_limited', `429 限流`, latencyMs);
    if (res.status === 401 || res.status === 403)
      return fail('auth_failed', `${res.status} 鉴权失败，统一 key 可能失效`, latencyMs);
    if (res.status >= 500) return fail('upstream_error', `${res.status} 上游错误`, latencyMs);
    if (res.status === 404)
      return fail('upstream_error', '404 端点不存在（可能已下线）', latencyMs);
    if (!res.ok) return fail('upstream_error', `${res.status} 意外响应`, latencyMs);

    // 200：区分"真活"与"假活"（empty_response = 最常见的假活，§4）
    interface ChatCompletionResponse {
      choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
      usage?: { completion_tokens?: number };
    }
    let body: ChatCompletionResponse | null = null;
    try {
      body = (await res.json()) as ChatCompletionResponse;
    } catch {
      return fail('empty_response', '200 但响应体不是 JSON', latencyMs);
    }
    const choice = body?.choices?.[0];
    const saidSomething =
      !!choice?.message &&
      (!!choice.message.content || !!choice.message.reasoning_content ||
        (body?.usage?.completion_tokens ?? 0) >= 1);
    if (!choice || !saidSomething)
      return fail('empty_response', '200 但没有任何内容产出（假活）', latencyMs);
    return { ok: true, latency_ms: latencyMs, error_class: null, error_message: null };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    if (err instanceof Error && err.name === 'AbortError')
      return fail('timeout', `超时 >${cfg.timeoutMs}ms（慢死）`, latencyMs);
    // 连不上网关本身：network_error 不算任何端点的失败（RECON_NOTES §5.2）
    const code = (err as { cause?: { code?: string } })?.cause?.code ?? '';
    return {
      ok: false,
      latency_ms: latencyMs,
      error_class: 'network_error' as ErrorClass,
      error_message: code ? `网关不可达 (${code})` : `网关不可达 (${String(err)})`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function fail(errorClass: ErrorClass, message: string, latencyMs: number): ProbeOutcome {
  return { ok: false, latency_ms: latencyMs, error_class: errorClass, error_message: message };
}
