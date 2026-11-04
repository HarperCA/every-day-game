# Jev 筛选

标题看不出来的候选，每条经 AI 总管 `ctx.ai.decide({ purpose: 'classify' })` 问 Jev 一次，按 7 个类别的概率分去向。

- **接口**：`Jev筛选(候选们, ctx) → [{ key, 去向, 类别, 概率, 原因 }]`；`按概率分(概率)`
- `题目.mjs`：类别和说明（搬自 `JEV_CRITERIA`，原文不变），版本 jev-classify-v1
