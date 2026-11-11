# DeepSeek（ai/providers/deepseek）

DeepSeek 的对话和联网搜索。

- **会的能力**：chat（OpenAI 格式，关掉思考模式）、search（Anthropic 兼容接口的 web_search，只有标题和网址）
- **用在哪些用途**：extract、admission、arbitrate、assistant；search 补位的最后一家
- **密钥**：密钥目录里的 deepseek.key（旧服务器上对应 .extract-key）
- **现在的状态**：能用。2026-10-30 在美国服务器上用真实密钥（Codex 用真实命令行）试过，请求格式和返回解析都对得上
- **来源**：apps/miniprogram/cloudfunctions/assistant/deepseek.js（对话）、search-engines.mjs 的 deepseekEngine（搜索）

只管“怎么和这家打交道”，不管问什么；由 `../../common/call.mjs` 调用。规矩：只引用自己的文件夹和 `../../common/`。
