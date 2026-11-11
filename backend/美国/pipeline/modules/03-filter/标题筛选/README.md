# 标题筛选

程序化筛选，只看标题，能判的不用问 Jev。规则搬自 `crawler/lib/jevCandidateFilter.mjs` 的 `deterministicCandidateDecision`、`titleHasNoInfo`，不变。

- **接口**：`标题筛选(候选) → { 去向, 类别, 原因 } 或 null`；`没有信息量(title)`
