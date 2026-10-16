# 上海用户服务迁北京：数据迁移工具

本工具只完成只读导出和隔离演练，不切换服务、不启动提醒、不修改源库。

## 导出

在已授权且登录 CloudBase CLI 的主机执行：

```bash
python3 scripts/server/export-shanghai-users.py \
  --env daily-contest-dev-d8dbbhc653e221 \
  --out /private/backups/shanghai-snapshot
```

输出每个集合的 JSON 数组及 `manifest.json`（条数、内容哈希、导出起止时间、原始集合清单）。若日志集合尚未建立，只有在 `listCollections` 已证明不存在时才记录空表；权限、网络或导出失败不能当成空表。

导出包含 `user_account`、`favorite`、`reminder`、`user_preference`、`feedback`、`general_feedback`、`client_issues`、`client_stats`、`preference_stats`、`admin_state` 和 `event_edition_public_cache`。其中 `admin_state` 原文仅用于备份与派发审查，不自动覆盖目标管理数据库。

此导出不是跨集合事务快照。最后切换必须暂停上海用户写入及派发后重新导出；现阶段快照只能用于盘点和演练。

## 规划和隔离导入

对北京数据库做一致性 SQLite 备份，使用备份作为 `--target-db`，避免演练读取期间目标持续写入影响结果：

```bash
python3 scripts/server/migrate-shanghai-users.py \
  --source /private/backups/shanghai-snapshot \
  --target-db /private/backups/beijing-before.db \
  --appid wxb71625ff1404e4e5 \
  --report /private/backups/rehearsal-report.json \
  --staging-db /private/backups/beijing-rehearsal.db \
  --with-public-cache
```

- `--staging-db` 必须是不存在的新文件，不能覆盖现有数据库；目标库始终以只读方式打开。
- 不指定 `--staging-db` 时，仅生成冲突计划和汇总，不写数据库。
- 始终保留上海账号 ID；目标已有同 AppID/OpenID 时改其业务关联到上海 ID。
- 不跨 AppID 合并用户，不使用 UnionID 猜测归属。
- 账号撞号、重复微信身份、禁用状态冲突、孤儿记录、不同版本文档、重复收藏、重复提醒都会阻止导入。
- 原始提醒的授权、模板、时间、发送与重试字段原样保留；不会把未授权记录升级为已授权，不会重置已发送状态。
- 目标非用户集合原样保留。
- `--with-public-cache` 额外导入上海权威公开缓存，状态与字段原样保留；不导入美国主赛事库或修改发布门槛。
- 导入在事务中完成，随后逐集合、逐用户内容哈希及 SQLite 完整性检查。
- 重复演练应指定新输出文件；同样输入得到同样内容哈希，不重复生成业务记录。

计划报告只保留匿名摘要；真实账号映射在同目录的 `.private-account-map.json` 中，Unix 权限为 `0600`。私有导出、数据库与映射不得进 Git。

## 北京连接未知时

可以建立空的隔离数据库验证上海自身数据，但不能把美国库冒充北京目标库。美国备份可用于独立检查旧版写入和账号冲突，报告必须标明实际来源。

## 不能据此直接切换

`readyForCutover` 永远为 `false`。上线还需独立确认微信合法域名、身份桥接、微信发送白名单、唯一派发节点、真机授权与送达、回退增量同步。数据演练通过不等于服务迁移完成。
