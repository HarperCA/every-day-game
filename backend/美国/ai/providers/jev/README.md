# Jev（ai/providers/jev）

经 OpenRouter 的 decisions 接口调 typesafe/jev-1.13：给一组选择题和材料，交回每题选了什么、各类别的概率。

- **会的能力**：decide（判断）
- **用在哪些用途**：classify（03 筛选）。04 读正文原来让 Jev 挑报名、章程链接（rankLinks），2026-11-01 改用读网页分好的链接，去掉了
- **要注意的**：OpenRouter 从国内访问不稳，只在美国服务器上用；题目怎么出、概率多少算有把握由调用方定
- **密钥**：密钥目录里的 jev.key（OpenRouter 的密钥；旧服务器上对应 .openrouter-key）
- **现在的状态**：能用。2026-10-30 在美国服务器上用真实密钥（Codex 用真实命令行）试过，请求格式和返回解析都对得上
- **来源**：crawler/lib/jevCandidateFilter.mjs、crawler/lib/jevLinkRanker.mjs

只管“怎么和这家打交道”，不管问什么；由 `../../common/call.mjs` 调用。规矩：只引用自己的文件夹和 `../../common/`。
