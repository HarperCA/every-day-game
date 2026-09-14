# 大学生竞赛推荐微信小程序 MVP

本仓库已实现首轮可运行纵向切片：30场Excel底稿规范化、发布门槛校验、原生微信小程序列表/搜索/三筛选/排序/详情/推荐/复制链接，以及独立React管理后台基础工程。

## 环境

- Node.js 20+
- pnpm 9+
- Python 3.11+，安装 `openpyxl` 与 `python-docx`
- 微信开发者工具（预览用户端时需要）

本轮使用 Codex 捆绑运行时完成验证。没有微信 AppID、云环境 ID 或密钥也可运行 Mock。

## 数据命令

```powershell
python scripts/convert_excel.py --input "C:\path\赛事底稿.xlsx"
python scripts/validate_seed.py
python scripts/build_miniprogram_seed.py
python scripts/import_seed.py --dry-run
```

转换结果位于 `data/seed/competitions.json`。所有30场赛事默认是 `pending_manual_review`；Mock 客户端会显示醒目的开发预览提示，生产适配器不得读取这些记录。

## 微信小程序

1. 打开微信开发者工具。
2. 选择“导入项目”，目录指向 `apps/miniprogram`。
3. 没有正式 AppID 时使用测试号/游客模式；`project.config.json` 当前为 `touristappid`。
4. 编译后从“找比赛”进入列表，测试搜索、筛选、分页、详情、收藏、站内提醒和复制链接。

提醒开发模式会保存在当前设备。只有配置真实订阅消息模板 ID 后，保存提醒或在“我的提醒”主动点击授权时才请求微信通知权限；未配置或拒绝授权不会删除站内提醒。

正式接入时复制 `project.config.example.json` 的配置结构并只在本机填写 AppID。AppSecret 不得写入该文件或前端源码。

## 管理后台

```powershell
pnpm install
pnpm admin:dev
```

打开 Vite 输出的本地地址，输入 CloudBase `adminData` 云函数环境变量中的 `ADMIN_TOKEN`。赛事、纠错、AI 任务和审计记录以 CloudBase 为主存储，浏览器本地存储只作网络异常缓存；支持字段校验、组合筛选、分页、JSON 导出、恢复种子数据和最近操作记录。纠错采纳会联动赛事复核状态，AI 重试只进入队列，关键动作写入 `audit_log`。详细配置见 `docs/admin-cloudbase.md`。

## 测试与构建

```powershell
pnpm test
pnpm admin:build
pnpm admin:verify:cloud
pnpm public:verify:cloud
pnpm data:import:dry
pnpm data:import:prepare
pnpm sources:verify
```

## 云开发配置

1. 参考 `database/collections.json` 和 `database/schemas` 创建集合并配置字段约束。
2. 按 `database/indexes.json` 建立唯一索引和查询索引。
3. 采用 `database/security-rules.json` 的默认拒绝策略，所有写入通过云函数。
4. 在云函数“权限控制”中应用 `database/function-security-rules.json`；其中定时函数禁止客户端调用。权限规则属于环境配置，上传代码不会自动生效。
5. 在云函数环境变量中配置微信、CloudBase、管理员会话和可选AI Provider密钥。
6. 系统验证、来源在线可达性检查和人工核验通过后，才写 `event_edition_public_cache`。

## 当前限制

- 源PRD已完成结构读取，但本机缺少LibreOffice，未完成DOCX页面渲染式版面核验。
- 赛事URL可运行 `pnpm sources:verify` 生成 `reports/source-url-verification.json` 传输层可达性报告；该报告不自动修改 `validity_status`，也不等同于官方性、时效性和内容相关性的人工核验。
- 微信登录、收藏/提醒云同步、纠错提交和订阅消息发送已接入 CloudBase 云函数；正式运行仍需在微信后台完成 AppID、隐私保护指引、订阅消息模板、云函数触发器和安全域名配置，并进行真机验收。
- 管理后台已接入受 `ADMIN_TOKEN` 保护的 CloudBase 管理云函数和远程持久化；长期口令只在登录时提交一次，后续使用8小时短期签名会话。赛事、纠错和 AI 任务保存使用事务内版本检查，旧页面不会静默覆盖新修改；当前仍是单一超级管理员模式，尚未实现多管理员账号与角色权限。
- 赛事审核页已接入 Kimi 多模态审核助手。当前按 Kimi Code 配置：在 `adminData` 云函数设置 `AI_PROVIDER=kimi-code`、`AI_API_KEY`、`AI_MODEL=kimi-for-coding` 和 `AI_BASE_URL=https://api.kimi.com/coding/v1`；AI 只提供带证据的复核建议，最终通过与发布仍由管理员操作。
- 推荐来自底稿结构化迁移，全部待系统重新验证与管理员人工核验，不能作为正式发布数据。
- `publicData` 云函数和公开缓存事务已实现，但当前环境尚未应用 `database/function-security-rules.json`，匿名只读验收会返回 `EXCEED_AUTHORITY`；在权限规则应用且首条合规缓存生成前，`USE_CLOUD_PUBLIC_DATA` 保持 `false`。
