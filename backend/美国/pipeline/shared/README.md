# 流程自己的小工具（pipeline/shared）

只剩每晚流程自己才用的路径工具。并发池、额度、日志、SQLite 已经挪到全后端复用的 `backend/共用/工具/`。

| 文件 | 作用 | 用法 |
|---|---|---|
| `paths.mjs` | 日志目录、按北京时间命名的运行文件夹、保留 90 天的清理 | `logRoot()`、`nextRunFolder(root)`、`removeExpiredRuns(root)` |

规矩：不引用 `modules/` 和总控里的任何文件。
