# AI 去重

程序去重留下的候选交 DeepSeek 判。规则、出错怎么办见上一级 README。

- **接口**：`AI去重(候选们, 库, ctx) → { 扔: [{ key, 原因 }], 问题们 }`
- `prompt.md`：提示词，第一行是版本号（现在 dedup-v1），用 `../../../common/prompt.mjs` 读。
- `schema.mjs`：返回格式和检查，检查不过就报告给 AI 总管并截断。
