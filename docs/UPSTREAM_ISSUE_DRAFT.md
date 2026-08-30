# 给上游的 issue / 互链草稿

> M4 交付物。用法： upstream 仓库开 issue（或 Discussion）时粘贴，亦可精简后放进自己仓库 README 互相链接。
> 语气基准：我们不是来提需求的是来交作业的——伴生工具已可用，附上边界说明。

---

**标题**：[show & tell] gauge.today — 外部视角的端点健康墙 & fallback 链生成器（伴生工具，MIT）

Hi！我是 freellmapi 的用户，做了一个小工具想分享给社区：**gauge.today**（https://github.com/<你>/gauge-today，MIT）。

**它做什么**：站在网关外面，对每个端点发真实的 `max_tokens: 1` 探测请求，画出一张健康墙——635 个端点哪些现在真能出字、P50/P95 多少、哪家供应商集体挂了；并按任务类型（视觉/长上下文/函数调用）推荐 Top3、一键生成 fallback 链 JSON。

**为什么是"外面"**：内置 Dashboard 的 Analytics 是 key 级额度视角（内部）；"从客户端视角看每个端点现在是否真能用"这个维度，黑盒探测是唯一不改上游就能拿到的信号。两个视角互补。

**设计上为上游着想的三件事**：
1. **零侵入**：伴生开发，只消费 `GET /v1/models` 和 `POST /v1/chat/completions` 两个公开契约，不读内部状态，上游改版不受影响；
2. **流量有预算**：分层调度（常用 5min / 长尾 30min / 尸体 2h）+ 全局每日上限（默认 3000）+ ±20% 抖动 + 并发池 5 + 429 自动降频 + `max_tokens:1` 零 token 消耗——不会把任何人的免费额度烧在监控上；
3. **同定位**：个人/家庭自托管工具，不做公共服务，不承诺 SLA。

**如果将来有缘**：若上游有意把"端点级外部健康"做成内置能力（哪怕只是一个可选的 `/internal/probe-report` 只读端点），gauge.today 的探测器愿意变成它的数据源之一。在那之前，伴生就是我们能给出的最稳妥形态。

相关背景：仓库 `RECON_NOTES.md` 里有一份接口地图侦察笔记（API 面/清单来源/鉴权/License），欢迎指正。

---

*（若开 Discussion 而非 issue，把标题改为 "Show & tell: gauge.today — a companion health wall for freellmapi" 即可。）*
