# gauge.today · 免费仪表盘

> 635 个免费端点，哪些现在真能用？谁最快？挂了自动切谁？
> 一面实时健康墙 + 一个路由建议器，给 [freellmapi](https://github.com/tashfeenahmed/freellmapi)（34 家免费 LLM 供应商聚合网关）配的伴生控制台。

**核心原则：只有真实请求算数。** 健康检查会说谎（`/health` 全绿 ≠ 模型真能出字），探测器向 `/v1/chat/completions` 发真实的 `max_tokens: 1` 请求，记录延迟与错误分类——key 失效、上游限流、空响应"假活"，全都原形毕露。

```
┌─ 总览 ──────────── 四张大数字卡 + 24h 故障时间线 + 探测预算余量
├─ 健康墙 ─────────── 每供应商一张卡：状态点 + 7 日 uptime 条带 + 延迟 sparkline
├─ 模型浏览器 ──────── 全量端点表格：状态 / P50 / P95 / 层级，可筛可排可标星
├─ 路由建议器 ──────── 选任务类型 → Top3 → 一键复制 fallback 链 JSON
└─ 设置 ──────────── 预算 / 分层间隔 / 并发 / 网关地址与 key，改完即生效
```

## 快速体验（无需真实网关）

```bash
pnpm install
pnpm demo        # 模拟上游 + 探测器 + 仪表盘 一键全起
# 浏览器开 http://127.0.0.1:3100 ，1 分钟内健康墙就会讲故事
```

demo 内置一个"确定性剧本"的假 freellmapi：快/慢/限流/5xx/空响应/401/周期抖动各占几个端点，用来完整演示错误分类、防抖、降频与路由建议。

## 接入你的真实 freellmapi

```bash
# 0. freellmapi 跑起来，并在其 Dashboard → Keys 生成 Unified API key
# 1. 拉取端点清单（base_url / key 也可之后在设置页里填）
GAUGE_BASE_URL=http://localhost:3001 GAUGE_API_KEY=freellmapi-xxxx pnpm discover
# 2. 启动常驻探测器
pnpm prober
# 3. 另开终端，启动仪表盘
pnpm dev         # http://127.0.0.1:3100
```

推荐用 PM2/systemd 跑 `pnpm prober`（探测是常驻进程），仪表盘按需启动。
防抖状态、层级、预算计数都存在 SQLite 里——prober 重启不会清零。

## 自托管说明

- **部署形态**：本机 / 家庭服务器 / 树莓派 / fly.io（挂持久卷）。需要常驻探测进程 + 持久 SQLite，这正是它不走 Vercel 的原因。
- **零编译**：数据库用 Node 24 内置的 `node:sqlite`（WAL 模式），没有原生模块，树莓派上也不用装构建工具链。
- **数据在哪**：`data/gauge.db`（可用环境变量 `GAUGE_DB_PATH` 改）。probes 保留 14 天，每日自动清理；预算 3000/日 × 14 天 ≈ 4.2 万行，SQLite 毫无压力。
- **安全**：仪表盘默认只监听 `127.0.0.1`；要给家庭局域网看，把 `apps/dashboard/package.json` 里的 `-H 127.0.0.1` 改成 `-H 0.0.0.0`。API key 明文存在本地 settings 表——这是给自托管单人用的取舍，请保证文件权限。
- **系列联动**：路由建议器产出的 fallback 链 JSON 直接贴进 freellmapi 路由策略或任意 OpenAI 客户端配置；`GET /api/stats` 输出总览 JSON，可供其他工具轮询做状态小挂件。

## 探测预算（别把免费额度烧在探测上）

635 个端点全量 5 分钟一探 = 每天 18 万次请求，自己就先把自己打爆了。因此：

| 机制 | 规则 |
|---|---|
| 分层调度 | ★常用 5 分钟 / 长尾 30 分钟 / 尸体（连 down >3 天）2 小时 |
| 每日预算 | 全局上限（默认 3000，可配），耗尽只保常用层 |
| 错峰抖动 | 间隔 ±20% 随机 + 并发池 5，避免整点同步风暴 |
| 零 token | 探测请求 `max_tokens: 1`（写死在 probe.ts 注释里，防止后人"顺手"改大） |
| 429 降频 | 被限流端点间隔 ×3（可配） |

**错误分类学**：`rate_limited`(429→黄) / `auth_failed`(401→红) / `upstream_error`(5xx→红) / `timeout`(>15s→红) / `empty_response`(200 无内容→红，最常见"假活") / `network_error`(网关不可达→不算端点失败，只亮横幅)。
**防抖**：连续 2 次失败才判 down，恢复需连续 2 次成功——单次抖动不改状态，健康墙不闪。

## 任务类型标签说明

模型浏览器的"视觉 / 长上下文 / 函数调用"筛选来自模型名**启发式推断**（discover 时写入），仅供快速筛选，不构成能力保证；`文本` 是所有端点的默认能力。星标（★）才是你亲手维护的"常用层"。

## 仓库结构

```
gauge-today/
├── apps/dashboard/    # Next.js 15 仪表盘（总览/健康墙/模型/路由/设置）
├── apps/prober/       # 常驻探测器（发现/调度/探测/防抖）+ demo 模拟上游
├── packages/shared/   # 类型 + SQLite 访问层 + 统计查询
├── docs/              # 上游 issue 草稿
└── RECON_NOTES.md     # P0 侦察笔记：接口地图与伴生决策
```

技术选型：pnpm monorepo · Next.js 15 + Tailwind 4 · node:sqlite（WAL）· setTimeout 自调度（无 cron 库）· 手写 SVG sparkline/条带（无图表库）。

## 边界与免责

- 本项目定位**个人/家庭自托管**，与上游 freellmapi 同定位（"Personal experimentation only"）：不承诺 SLA、不做公共服务、状态页只给自己看。
- 伴生开发：不 fork 上游、不依赖上游内部实现，只消费 `GET /v1/models` 与 `POST /v1/chat/completions` 两个公开契约（侦察笔记见 `RECON_NOTES.md`）。
- 免费端点的可用性取决于各供应商的免费政策，随时可能变化——这正是做这面墙的原因。
- 探测会给上游贡献真实流量（预算内、`max_tokens:1`），请保持默认预算设置，不要调高并发。

## v2 想法

告警推送（Webhook/Bark/Telegram）· 通用化纳管任意 OpenAI 兼容网关（含 Ollama）· 只读公开状态页 · Docker Compose 一键自托管 · 自然语言任务匹配端点。

---

*系列第八件 · gauge.today · 纸墨仪表盘美学（纸 `#F2EAD9` / 墨 `#2B2B26` / 砖红 `#B5482A` / 墨绿 `#3F5C4E` / 芥末黄 `#D9A441`）*
