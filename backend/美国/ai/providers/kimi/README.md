# Kimi（ai/providers/kimi）

Kimi 会员通道（api.kimi.com/coding/v1）。按月订阅，单次费用记 0。

- **会的能力**：chat（对话）、search（搜索）、fetchPage（在服务端执行页面脚本后读正文）
- **用在哪些用途**：review、verify（05 审核、维护/发布核验，沿用旧系统）；search 的第二家补位；reread（04 空壳页重读）
- **要注意的**：对话不带 temperature，要 JSON 时只用 json_object（不认 JSON 结构约束）；带 site: 的搜索没结果时接口报 500，重试后仍 500 按“没有结果”交回
- **密钥**：密钥目录里的 kimi.key（旧服务器上对应 .ai-key）
- **现在的状态**：能用。2026-10-30 在美国服务器上用真实密钥（Codex 用真实命令行）试过，请求格式和返回解析都对得上
- **来源**：cjs/competitionAiReview.js（对话参数）、search-engines.mjs 的 kimiEngine、kimiFetchPage

只管“怎么和这家打交道”，不管问什么；由 `../../common/call.mjs` 调用。规矩：只引用自己的文件夹和 `../../common/`。
