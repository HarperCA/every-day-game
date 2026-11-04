# Codex（ai/providers/codex）

在美国服务器本机起 Codex 命令行（codex exec），一次对话就是一次进程。按月订阅，单次费用记 0，token 照记。

- **会的能力**：chat（对话；给了 schema 时按 schema 交回 JSON）
- **用在哪些用途**：trace（03 筛选的 Codex 代理追踪的每一步），模型 gpt-6.1-sol、推理强度 xhigh（10-14 定）
- **安全**：只读沙箱、关掉命令行工具和本机执行、不读用户配置、不留会话；内置搜索默认关（配置里 codexSearch: true 才打开，效果还没验证）
- **超时**：先温和结束，再强制结束整组进程；结束不了时保留临时文件夹
- **密钥**：不用密钥（用服务器上已登录的 Codex 账号）；命令行位置可用环境变量 CODEX_BIN 指定
- **现在的状态**：能用。2026-10-30 在美国服务器上用真实密钥（Codex 用真实命令行）试过，请求格式和返回解析都对得上
- **来源**：scripts/server/codex-agent.mjs 的 codexChat

只管“怎么和这家打交道”，不管问什么；由 `../../common/call.mjs` 调用。规矩：只引用自己的文件夹和 `../../common/`。
