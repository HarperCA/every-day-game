# 技术架构

## 决策

项目采用单仓库，用户端为原生微信小程序 + TypeScript，管理端为 Vite + React + TypeScript。后端采用微信云开发（CloudBase）：用户登录、收藏、提醒、纠错和管理数据均经云函数读写；未登录或云端不可用时，用户端保留本地降级数据，待会话恢复后合并。赛事底稿仍属于开发预览数据，未通过发布门槛前不会作为正式公开数据。

赛事届次同时保存四个可筛选的规范字段：`participation_format`（参赛形式）、`team_size_category`（队伍人数）、`fee_type`（报名费用）和 `registration_organization`（报名组织方式）。参赛形式与报名组织方式不得复用同一字段；只允许依据明确资料录入，资料缺失时分别使用“暂未明确”或“暂未公布”。

## 目录

- `apps/miniprogram`：微信小程序。包含找比赛、详情、收藏、提醒、信息纠错、我的与开发预览赛事数据适配器；用户数据通过云函数同步。
- `apps/admin`：独立网页管理后台，通过 CloudBase Web SDK 调用受保护的 `adminData` 云函数，支持数据状态/报名状态筛选、审核发布、专业映射和异常查看。
- `packages/shared`：跨端枚举、类型、排序与过滤规则。
- `database`：CloudBase 集合、索引和权限规则建议。
- `scripts`：Excel 迁移、校验与导入工具。
- `data/seed`：规范化种子数据和迁移清单。
- `tests`：迁移、发布门槛、状态与筛选测试。

## 数据访问边界

`listCompetitions(query)` 与 `getCompetition(id)` 是用户端唯一读取入口。`publicData` 生产适配器只返回 `data_status=published`、系统验证通过且人工核验通过的公开缓存；早期用 30 场本地种子数据的“开发预览”适配器已于 2026-09-30 删除，小程序只读公开缓存。

用户端不调用 AI。推荐在管理端生成、系统验证、人工核验后缓存，缓存键为 `event_edition_id + event_data_version + recommendation_rule_version`。

## 正式部署与验收点

1. 管理后台发布时会在同一数据库事务中生成或删除 `event_edition_public_cache`；生产读取切换前需应用云函数权限规则，并运行 `pnpm public:verify:cloud`。
2. 微信 AppID、隐私保护指引、订阅消息模板、云函数触发器和安全域名仍需在正式账号中配置并真机验收。
3. 微信登录、订阅消息和 AI Provider 只允许在云函数或受控服务端运行。
4. 管理后台通过 `adminData` 的短期签名会话访问，集合保持默认拒绝；状态写入使用事务内版本检查，冲突时拒绝旧页面覆盖。

## 安全

- 前端只保存短期会话标识，不保存 AppSecret、AI Key 或数据库管理凭据。
- 数据库默认拒绝客户端写入；收藏、提醒、纠错通过云函数校验用户身份后写入。
- 发布、下架、归档和人工核验只允许超级管理员服务端执行并记录 `audit_log`。
- 已存在收藏、提醒、推荐或审核关联的届次只能归档或下架，不能物理删除。
