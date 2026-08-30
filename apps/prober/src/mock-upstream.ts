// 模拟 freellmapi：确定性剧本的假上游，只实现 /v1/models 与 /v1/chat/completions。
// 供 demo 模式与端到端验收用——正式环境不需要它。

import type { ServerResponse } from 'node:http';

interface MockModel {
  id: string;
  /** ok | rate | err5xx | empty | auth | slow | wobble */
  behavior: 'ok' | 'rate' | 'err5xx' | 'empty' | 'auth' | 'slow' | 'wobble';
  minMs: number;
  maxMs: number;
}

export const MODELS: MockModel[] = [  { id: 'groq/llama-3.3-70b-versatile', behavior: 'ok', minMs: 120, maxMs: 380 },
  { id: 'groq/llama-3.1-8b-instant', behavior: 'ok', minMs: 90, maxMs: 260 },
  { id: 'cerebras/qwen-3-32b', behavior: 'ok', minMs: 80, maxMs: 240 },
  { id: 'cerebras/llama-4-scout-17b', behavior: 'ok', minMs: 110, maxMs: 300 },
  { id: 'google/gemini-2.5-pro', behavior: 'ok', minMs: 600, maxMs: 1400 },
  { id: 'google/gemini-2.0-flash', behavior: 'ok', minMs: 350, maxMs: 800 },
  { id: 'zai/glm-5', behavior: 'ok', minMs: 400, maxMs: 900 },
  { id: 'mistral/mistral-large-latest', behavior: 'slow', minMs: 4200, maxMs: 5200 },
  { id: 'openrouter/qwen-2.5-vl-72b', behavior: 'rate', minMs: 200, maxMs: 500 },
  { id: 'openrouter/deepseek-v3.2', behavior: 'wobble', minMs: 300, maxMs: 700 },
  { id: 'nvidia/nemotron-4-340b', behavior: 'err5xx', minMs: 150, maxMs: 400 },
  { id: 'huggingface/Qwen2.5-72B-Instruct', behavior: 'empty', minMs: 200, maxMs: 600 },
  { id: 'modelscope/qwen3-coder-480b', behavior: 'ok', minMs: 500, maxMs: 1200 },
  { id: 'cohere/command-r-plus-08-2024', behavior: 'auth', minMs: 100, maxMs: 300 },
];

let wobblePhase = 0; // 周期抖动：连续两次失败判 down → 能演示防抖黄/红切换

export function startMockUpstream(port: number): Promise<void> {
  // 用 node:http 保持零依赖；listening 后 resolve，调用方再启动探测
  return import('node:http').then(
    ({ default: http }) =>
      new Promise<void>((resolve) => {
        const server = http.createServer((req, res) => {
          const url = new URL(req.url ?? '/', 'http://localhost');
          if (req.method === 'GET' && url.pathname === '/v1/models') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                object: 'list',
                data: MODELS.map((m) => ({
                  id: m.id,
                  object: 'model',
                  owned_by: m.id.split('/')[0],
                })),
              }),
            );
            return;
          }
          if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
            let body = '';
            req.on('data', (c: Buffer) => (body += c));
            req.on('end', () => {
              let modelId = '';
              try {
                modelId = (JSON.parse(body) as { model?: string }).model ?? '';
              } catch {
                /* ignore */
              }
              const m = MODELS.find((x) => x.id === modelId);
              if (!m) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'model not found' } }));
                return;
              }
              const delay = m.minMs + Math.random() * (m.maxMs - m.minMs);
              setTimeout(() => respond(m, res), delay);
            });
            return;
          }
          res.writeHead(404).end();
        });
        server.listen(port, '127.0.0.1', () => resolve());
      }),
  );
}

function respond(m: MockModel, res: ServerResponse): void {
  const sendOk = () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        choices: [
          { index: 0, message: { role: 'assistant', content: '!' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  };

  switch (m.behavior) {
    case 'ok':
      return sendOk();
    case 'slow':
      return sendOk();
    case 'rate':
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } }));
      return;
    case 'err5xx':
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'upstream unavailable' } }));
      return;
    case 'auth':
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
      return;
    case 'empty':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion', choices: [] }));
      return;
    case 'wobble': {
      // 6 拍一轮：4 成功 → 2 失败（5xx），演示防抖的"2 次才判死/2 次才复活"
      wobblePhase = (wobblePhase + 1) % 6;
      if (wobblePhase >= 4) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'temporarily unavailable' } }));
      } else {
        sendOk();
      }
      return;
    }
  }
}
