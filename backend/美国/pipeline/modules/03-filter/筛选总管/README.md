# 筛选总管

03 筛选的主流程：按顺序调标题筛选、Jev 筛选、Codex 代理追踪，照每条的去向经 `ctx.小数据库` 的查找、删除、标记线索维护当晚的条目。流程和去向见上一级 README。

- `index.mjs`：`createRun(parts)`、`run(input, ctx)`
- `读不了的网站.mjs`：微信公众号、百度百科（robots 不让抓），判成读详情时改去追溯
