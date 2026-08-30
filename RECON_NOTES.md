# P0 侦察笔记 · freellmapi →「免费仪表盘 gauge.today」

> 2026-08-30 · 结论先行：**伴生开发**（黑盒真实探测，不 fork、不依赖上游内部）
> 侦察对象：https://github.com/tashfeenahmed/freellmapi

## 1. 接口地图（API 面）

上游把 34 家免费供应商、635 个免费端点（584 chat）聚合在一个 OpenAI 兼容 `/v1` 后面（默认 `http://localhost:3001/v1`）。

| 端点 | 对本项目的意义 |
|---|---|
| `GET /v1/models` | **端点发现来源**（discover.ts 每次启动拉取，程序化"重新发现"成立） |
| `POST /v1/chat/completions` | **探测目标**（`max_tokens:1` + `"hi"`，真实请求才算数） |
| `/v1/responses`、`/v1/completions`、`/v1/embeddings`、`/v1/images|audio|videos` | v2 可扩展探测面（本期只测 chat） |
| `/v1/docs`（OpenAPI viewer）、`/mcp` | 参考价值，无监控用途 |
| `/v1/messages`（Anthropic 格式）、`/v1beta`（Gemini 格式） | 不用 |
| **健康/状态/配额 HTTP 接口** | **不存在**。配额分析只在其内置 Dashboard（Keys/Analytics/Playground 页）里，健康检查是进程内部的 key 级轮换——对外不可读 |

**推论**：上游没有可编程读取的状态接口 → "从外面看每个端点是否真能出字"这个维度上游根本不提供，正是本项目的生存空间。

## 2. 模型清单与鉴权

- 清单来源：上游路由器每日两次从 freellmapi.co 同步**签名目录**（Ed25519 校验）；免费安装有 ~30 天滞后（约 303 个模型后）。对本项目无所谓——我们不读上游目录，只读运行实例的 `/v1/models`，它返回什么我们探什么（黑盒基线，上游改版不影响）。
- 鉴权：客户端持有统一 bearer token（`freellmapi-…`，Dashboard → Keys → Unified API key 生成）。prober 只需要 `BASE_URL` + 这一个 key，`Authorization: Bearer <key>`。多 key 轮换是上游内部事务，与我们无关。
- 模型 ID 形态：`/v1/models` 为 OpenAI 标准结构（`data[].id` + `owned_by`）。discover 做三级解析：`owned_by` → id 的 `provider/` 前缀 → 兜底 `other`，对任意命名规则都鲁棒。

## 3. License 与活跃度

- **MIT**（README 明言 "The router itself stays MIT-licensed and fully free, forever"）→ 伴生引用、README 互链、未来 PR 全部合规。
- 活跃：仓库描述即 "34 providers / 635 endpoints"；issue 区 270+ 条相关讨论，含 health-check、degraded-mode 状态机等主题。**上游已有内置 Dashboard**，"社区要 admin UI" 的命题已被上游自己部分满足。
- 免责边界：上游官方定位 "Personal experimentation only" → 本项目同样定位个人/家庭自托管，不做公共服务、不承诺 SLA。

## 4. 决策：伴生（默认路线，无悬念）

按开发文档 §6 的两条路线过一遍：

- **fork 路线不成立**：fork 的前提是"上游已有半成品管理端点且代码可读、四项检查全达标"。实际上游是单体应用（server/client/desktop/cli 五端合一，规模远超 3000 行），其 Dashboard 是 React 内置管理台而非可独立复用的管理 API；fork 反而把我们绑死在它的技术栈和发版节奏上。
- **伴生路线完全成立**：我们唯一依赖的是两个**公开稳定契约**——`GET /v1/models`（OpenAI 标准）与 `POST /v1/chat/completions`（OpenAI 标准）。上游怎么改内部实现、改目录格式、改数据库，都不影响本项目。黑盒真实探测正是为此设计（开发文档 §4）。
- 与上游内置 Dashboard 的差异化定位：它回答"我的 key 用了多少额度"（内部视角），我们回答"**635 个端点现在哪些真能出字、谁最快、挂了切谁**"（外部视角 + 下游消费）。两者互补，README 里互链而不是竞争。

给上游的 issue/互链草稿见 `docs/UPSTREAM_ISSUE_DRAFT.md`（M4 交付物）。

## 5. 实现层的两处务实偏离（相对开发文档 §3）

1. **`node:sqlite`（Node 24 内置）替代 better-sqlite3**：API 同为同步 prepare/run/get/all + PRAGMA WAL，行为等价；省掉 Windows/树莓派上的 node-gyp 原生编译，自托管"零编译"更符合项目气质。封装在 `packages/shared/db.ts`，未来想换回 better-sqlite3 只动这一个文件。
2. **错误分类学增加 `network_error`**：网关进程本身不可达（ECONNREFUSED）时，635 个端点会同时"变红"造成误读——单列一类，仪表盘改为顶部横幅"网关不可达"，不算作任何端点的失败。开发文档 §4 的五类保持不变。

## 6. 里程碑推进（随开发更新）

- P0 侦察 ✅（本笔记）
- M0 骨架 ✅（monorepo + schema + prober 空转 + dashboard 骨架）
- M1 探测器 ✅（发现 + 分层调度 + 真实探测 + 错误分类 + 防抖 + 预算）
- M2 仪表盘 ✅（总览 + 健康墙 + 模型浏览器 + 手写 SVG 图形）
- M3 路由建议器 ✅（Top3 + fallback 链导出 + 一键复制）
- M4 打磨 ✅（设置页 + 14 天清理 + prober 心跳/重启恢复 + README 自托管指南 + issue 草稿）

系列联动验收（M3）：路由建议器产出的链贴进 #03/#05/#07 的 BASE_URL/model 配置即用——待用户跑起真实 freellmapi 后补验。
