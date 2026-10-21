# 赛事助手分支与主线对齐记录

日期：2026-10-21

## 执行顺序与基线

1. 在本地 `main` 执行 `git push origin main`，远程返回 `Everything up-to-date`。
2. 执行 `git fetch origin --prune`，确认远程主线为 `017bc4f1c025f8865e21730f94ef760a1b44d7cc`。
3. 目标分支为 `feat/assistant-deepseek`，原提交为 `bb081a55d4f75624821e07d0b23a3e557cb2a7cd`。
4. 保留本地备份分支 `codex/assistant-before-main-sync-20261021`，再处理目标分支。

## 实际检查结果

目标分支原本已经包含当前主线提交。核对工作区后发现，与主线的差异主要为赛事助手本体及必要接入代码，未发现需要整体替换的旧版非 AI 业务实现。本次仍先按主线恢复所有受版本控制的路径，再按明确范围恢复助手代码，避免仅凭合并状态判断一致。

详情页 `apps/miniprogram/pages/detail/detail.ts` 的一处注释恢复为主线文本。因此本次相对原助手分支的代码差异很小，不能将其表述为修复了大量已有功能缺陷。

## 保留的 AI 范围

- 助手云函数、对话页面、客户端服务及专用图标。
- 首页助手入口及助手筛选条件回填。
- 助手会话请求、接口挂载及微信文本内容检测接口。
- 助手相关隐私说明、部署配置、专项测试与原有执行文档。

首页、会话服务、服务器入口等共用文件只保留既有分支中与助手相关的接入差异；其他业务实现来自本次主线。

助手中的 `publicQuery.js`、`competitionRanking.js`、`competitionValue.js`、`majorKeywords.js`、`undergraduateMajors2026.json` 已重新从主线 `publicData` 复制，逐字节核对一致；仓库现有 `assistant-copies.test.mjs` 对其持续检查。

## 验证

- 非 AI 路径与 `origin/main` 的差异检查：通过，未发现范围外差异。
- `pnpm exec vitest run`：147 个测试文件、1444 项测试全部通过。
- `python -m unittest discover -s tests -p 'test_*.py'`：32 项测试全部通过。
- `pnpm exec tsc --noEmit -p apps/miniprogram/tsconfig.json`：通过。
- 操作前的 18 项未跟踪文件仍保留，未提交这些临时文件和会话资料。

本次验证不包含真实模型 API 调用、线上接口联调或真机验证；未部署服务器、未上传小程序，也未修改主线业务代码。

## 提醒行为补充核对与修复

用户指出提醒行为没有完整接齐后，进一步对比实际入口，而非只比较提醒服务文件。发现：

- 主线详情页已有提醒时点击铃铛会直接取消；原助手页无论是否已有提醒，都直接跳转设置面板。
- 原助手页只在 `onShow` 当下读取提醒，没有在 `userDataReady` 同步完成后刷新，可能显示旧的铃铛状态。
- 原助手页面测试只验证“点铃铛跳转设置”，没有覆盖取消、同步等待及跨页面共用提醒的行为。因此此前全套测试通过不能证明助手已完整接入主线提醒交互。

本次仅修改助手页面及其测试：已有提醒调用主线 `removeRemindersForEdition`，无提醒才跳转主线详情设置；操作前确认登录并等待已有用户同步；取消后刷新所有回答中同一赛事的铃铛；阻止连续点击触发重复操作；页面离开后不再执行旧的同步刷新回调。

主线的 `services/reminders.ts`、详情页、提醒列表、`userData` 和 `sendReminders` 均未修改。保存授权、自定义时间校验、账号隔离、删除同步与后台派发继续使用主线实现。

验证：

- 新增回归场景在修复前复现 5 项失败，修复后通过。
- 9 个相关测试文件、71 项测试通过；小程序 TypeScript 检查通过。
- 新增跨页面集成测试使用真实提醒服务，覆盖授权保存、助手取消、云删除请求、再次设置及拒绝授权不保存。仅微信及网络边界使用测试替身，未请求真实微信授权或调用线上接口。

## 对主线保留的助手差异清单（首次核对）

以下为核对时与主线不同的路径；本记录文件另计。

- `apps/miniprogram/app.json`
- `apps/miniprogram/assets/bell-active.svg`
- `apps/miniprogram/assets/bell.svg`
- `apps/miniprogram/assets/radar.svg`
- `apps/miniprogram/assets/send.svg`
- `apps/miniprogram/cloudfunctions/assistant/askValidation.js`
- `apps/miniprogram/cloudfunctions/assistant/assistantCore.js`
- `apps/miniprogram/cloudfunctions/assistant/competitionRanking.js`
- `apps/miniprogram/cloudfunctions/assistant/competitionValue.js`
- `apps/miniprogram/cloudfunctions/assistant/config.json`
- `apps/miniprogram/cloudfunctions/assistant/conversationLog.js`
- `apps/miniprogram/cloudfunctions/assistant/deepseek.js`
- `apps/miniprogram/cloudfunctions/assistant/index.js`
- `apps/miniprogram/cloudfunctions/assistant/majorKeywords.js`
- `apps/miniprogram/cloudfunctions/assistant/package.json`
- `apps/miniprogram/cloudfunctions/assistant/prompt.js`
- `apps/miniprogram/cloudfunctions/assistant/publicQuery.js`
- `apps/miniprogram/cloudfunctions/assistant/publicRecords.js`
- `apps/miniprogram/cloudfunctions/assistant/secCheck.js`
- `apps/miniprogram/cloudfunctions/assistant/tools.js`
- `apps/miniprogram/cloudfunctions/assistant/undergraduateMajors2026.json`
- `apps/miniprogram/pages/assistant/assistant.json`
- `apps/miniprogram/pages/assistant/assistant.ts`
- `apps/miniprogram/pages/assistant/assistant.wxml`
- `apps/miniprogram/pages/assistant/assistant.wxss`
- `apps/miniprogram/pages/index/index.ts`
- `apps/miniprogram/pages/index/index.wxml`
- `apps/miniprogram/pages/index/index.wxss`
- `apps/miniprogram/services/assistant.ts`
- `apps/miniprogram/services/cloudSession.ts`
- `apps/miniprogram/services/infoContent.ts`
- `apps/server/src/index.mjs`
- `apps/server/src/wechat.mjs`
- `docs/赛事助手-体验版-第一步后端执行文档.md`
- `scripts/server/assistant-smoke.mjs`
- `scripts/server/daily-contest-api.service`
- `scripts/server/deploy-selfhosted.sh`
- `tests/assistant-copies.test.mjs`
- `tests/assistant-core.test.mjs`
- `tests/assistant-fixtures.mjs`
- `tests/assistant-index-filters.test.ts`
- `tests/assistant-page.test.ts`
- `tests/assistant-storage.test.mjs`
- `tests/assistant-tools.test.mjs`
- `tests/assistant-validation.test.mjs`
- `tests/miniprogram-shared.test.mjs`
- `tests/wechat-msg-sec-check.test.mjs`


## 从主线重新建分支并嵌入助手

按用户最新要求，于 2026-10-21 重新执行：

1. 再次 `git fetch origin --prune`，主线仍为 `017bc4f1c025f8865e21730f94ef760a1b44d7cc`。
2. 保存原分支，并另建备份 `codex/assistant-before-rebuild-20261021`，指向 `bacee91`。
3. 直接从远程主线建立 `codex/assistant-on-main-20261021`，在嵌入前检查工作树受控文件与主线完全一致。
4. 将审核过的助手新增文件及必要的共用文件接入差异作为补丁嵌入；保留此前助手提醒接入修复。原始补丁备份于系统临时目录 `contest-assistant-main-rebuild-20261021.patch`。
5. 核对主线已有文件：仅 11 个共用文件保留上述助手接入差异，没有删除主线文件。详情、提醒管理、偏好、我的、后台管理、用户数据、提醒派发及公开数据模块与主线一致。
6. 用户原有临时文件和会话资料保留，没有加入提交。

重建后的功能代码与重建前已经审核的助手快照一致；本次重建确认了主线基线和嵌入范围，并不意味着新修复了额外的运行问题。

重建后重新执行的验证：

- Vitest：148 个测试文件、1453 项测试全部通过。
- Python unittest：32 项测试全部通过。
- 小程序 TypeScript 类型检查：通过。

此次仅保存到本地分支，未推送 GitHub、未部署服务器、未上传小程序；未执行真实模型和微信真机验证。
