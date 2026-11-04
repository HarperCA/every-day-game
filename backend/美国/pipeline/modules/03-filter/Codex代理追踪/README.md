# Codex 代理追踪

要追溯的候选交给 Codex 追到比赛自己的官方来源。Codex 只做决定（`ctx.ai.chat({ purpose: 'trace', json: true })`），程序替它搜索、读网页，最多 6 轮，同时追 2 条。改编自旧的 `scripts/server/notice-agent.mjs`。

- **接口**：`Codex代理追踪(通知们, ctx, { 并发, 轮数 })` → 每条 `{ key, 结果, 原因, 比赛名, 官方来源 }` 或 `{ key, 顺延: true, 原因 }`
- `prompt.md`：提示词，第一行是版本号（现在 trace-v1）
- `schema.mjs`：每轮的动作格式和五种结果
- 读网页经 `ctx.web.读网页`（自己的程序读，不交给 Kimi）；`网页给Codex()` 把正文截到 6000 字、列出最多 15 个链接。
- 比旧的简化的地方：旧的每页经 Kimi 读、再让 DeepSeek 摘要点逐字核对；这里直接给正文；只要比赛名和官方来源，字段留给 04 读详情和抽取。
