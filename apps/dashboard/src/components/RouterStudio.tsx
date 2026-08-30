'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RouterSuggestion, TaskType } from '@gauge/shared/labels';
import { TASK_TYPE_LABEL } from '@gauge/shared/labels';
import { fmtMs, fmtPct } from '@/lib/format';

const TASKS: TaskType[] = ['vision', 'text', 'longcontext', 'function'];

export function RouterStudio() {
  const [task, setTask] = useState<TaskType>('text');
  const [data, setData] = useState<RouterSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savedNote, setSavedNote] = useState('');

  const generate = useCallback(async (t: TaskType) => {
    setLoading(true);
    setSavedNote('');
    try {
      const res = await fetch(`/api/router?task=${t}`);
      setData((await res.json()) as RouterSuggestion);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void generate(task);
  }, [task, generate]);

  const chainJson = data
    ? JSON.stringify(
        {
          chain: data.chain.map((c) => c.model_id),
          note: `生成于 gauge.today，基于最近 2h 真实探测（${new Date(data.generated_at).toLocaleString('zh-CN', { hour12: false })}）`,
        },
        null,
        2,
      )
    : '';

  async function copy() {
    await navigator.clipboard.writeText(chainJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function saveChain() {
    if (!data) return;
    const res = await fetch('/api/chain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, steps: data.chain.map((c) => c.model_id) }),
    });
    const j = (await res.json()) as { id?: number };
    if (j.id) setSavedNote(`已存入 fallback_chains #${j.id}`);
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs text-ink-soft">任务类型</span>
        {TASKS.map((t) => (
          <button
            key={t}
            onClick={() => setTask(t)}
            className={
              'btn px-3 py-1.5 text-xs ' + (task === t ? 'btn-primary' : '')
            }
          >
            {TASK_TYPE_LABEL[t]}
          </button>
        ))}
        <button onClick={() => generate(task)} disabled={loading} className="btn ml-auto px-3 py-1.5 text-xs">
          {loading ? '生成中…' : '重新生成'}
        </button>
      </div>

      {data && (
        <>
          {/* Top3 */}
          <div className="grid gap-3 md:grid-cols-3">
            {data.chain.map((c, i) => (
              <div key={c.model_id} className="card relative p-4">
                <span className="tnum absolute right-3 top-3 text-2xl font-bold text-ink/15">#{i + 1}</span>
                <div className="font-mono text-xs font-bold break-all">{c.model_id}</div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
                  <div>
                    <div className="tnum text-sm font-bold">{fmtMs(c.p50_ms)}</div>
                    <div className="text-ink-faint">P50</div>
                  </div>
                  <div>
                    <div className="tnum text-sm font-bold">{fmtPct(c.uptime_24h)}</div>
                    <div className="text-ink-faint">24h uptime</div>
                  </div>
                  <div>
                    <div className="tnum text-sm font-bold">{c.samples}</div>
                    <div className="text-ink-faint">样本</div>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-ink-soft">
                  供应商 {c.provider_id} · {c.status === 'up' ? '当前绿' : '当前黄（限流）'}
                </div>
              </div>
            ))}
            {data.chain.length === 0 && (
              <div className="card p-6 text-sm text-ink-soft md:col-span-3">
                这个任务类型下暂时没有可用端点（可能都在挂，或标签还没被探测覆盖）。等下一轮探测或换个类型。
              </div>
            )}
          </div>

          {/* 导出 */}
          <div className="card p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold">fallback 链 JSON</h2>
              <span className="text-[11px] text-ink-soft">{data.window_label}</span>
              <div className="ml-auto flex gap-2">
                <button onClick={copy} className="btn btn-primary px-3 py-1.5 text-xs">
                  {copied ? '✓ 已复制' : '一键复制'}
                </button>
                <button onClick={saveChain} className="btn px-3 py-1.5 text-xs">
                  存档
                </button>
              </div>
            </div>
            <pre className="tnum overflow-x-auto rounded-sm bg-ink p-3 text-[11px] leading-relaxed text-paper">
              {chainJson}
            </pre>
            {savedNote && <p className="mt-1 text-[11px] text-moss">{savedNote}</p>}
            <p className="mt-2 text-[11px] text-ink-soft">
              贴进 #03 网页摘要扩展的端点设置、#05 冰箱食堂的 <code>BASE_URL</code>、#07 杠精剧场的引擎配置，直接可用——
              自己探测出来的免费端点，喂给自己的工具。
            </p>
          </div>
        </>
      )}
    </div>
  );
}
