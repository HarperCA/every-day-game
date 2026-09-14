# CloudBase 数据库交付说明

本目录是可部署的数据契约，不包含线上环境凭据，也不会绕过云函数直接开放写权限。

## 文件

- `collections.json`：集合、关系、Schema 路径与写入契约。
- `schemas/*.schema.json`：赛事届次、公开缓存和审计日志字段约束。
- `indexes.json`：列表组合筛选、排序和用户数据所需索引。
- `security-rules.json`：默认拒绝、公开缓存只读和服务端写入边界。

## 准备导入文件

```powershell
python scripts/validate_seed.py
python scripts/import_seed.py --dry-run
python scripts/import_seed.py --output-dir data/cloudbase-import
```

最后一个命令只生成 JSONL 和 `manifest.json`，不会上传远程数据库。准备正式上传时设置 `CLOUDBASE_ENV_ID`，再使用 `--require-env` 生成带目标环境标识的清单。上传必须在管理员确认集合、索引和备份后通过已认证的 CloudBase CLI 执行。

`event_edition_public_cache` 只从同时满足 `published`、系统验证通过和人工审核通过的届次生成。当前30条底稿均未通过人工审核，因此公开缓存导入文件应为空，这是发布门槛生效的正常结果。

## 微信登录与用户数据绑定

1. 在微信开发者工具中开通云开发并创建环境。
2. 将环境 ID 填入 `apps/miniprogram/config/cloud.ts` 的 `CLOUD_ENV_ID`。
3. 创建 `user_account`、`favorite`、`reminder` 集合，并按 `indexes.json` 创建唯一索引。
4. 在开发者工具中分别右键 `cloudfunctions/login` 和 `cloudfunctions/userData`，选择“上传并部署：云端安装依赖”。
5. 真机登录后确认 `user_account` 出现当前微信用户记录，再验证收藏和提醒能够在重新进入小程序后恢复。

登录与用户数据读写只允许通过云函数完成。小程序不会保存 AppSecret，也不会信任客户端传入的 OpenID 或 user_id；`userData` 云函数始终使用 `cloud.getWXContext()` 重新识别调用者。
