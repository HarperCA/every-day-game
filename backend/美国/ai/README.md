# AI 总管（backend/美国/ai）

**只负责 AI 和搜索接口的统一管理和分发**：密钥、发给哪家、补位、每天次数、额度、排队、超时、重试、记账。
要问什么、提示词怎么写、返回结果怎么处理，由用到它的地方自己做：每晚流程的各个模块（提示词放在模块自己的文件夹里）、赛事助手。

管 5 家接口、4 种能力（2026-10-30 起，原来只管 DeepSeek、Codex）：

| 接口 | 对话 | 搜索 | 读网页 | 判断 |
|---|---|---|---|---|
| DeepSeek | ✓ | ✓（补位第三家） | | |
| Kimi | ✓ | ✓（补位第二家） | ✓ | |
| 百度 | | ✓（补位第一家，每天自动 30 次） | | |
| Jev | | | | ✓ |
| Codex | ✓（美国本机命令行） | | | |

微信不放进来；只有这里读这些接口的密钥。

```
ai/
  index.mjs        唯一入口：session() 开会话，会话上有 chat、search、fetchPage、decide
  common/          复用：会话、分发和调用流程（含补位、每天次数）、发请求、密钥、记账、配置、错误类型
  providers/       每家接口一个文件夹，只放和这家打交道的特有部分
    deepseek/  kimi/  baidu/  jev/  codex/
  test/            测入口和引用规矩；test/复用/ 是 ai 下面共用的假接口（每个有代码的子文件夹也有自己的 test/）
  usage.db         用量库（运行时生成，不进 git）
```

## 怎么用

```js
import * as ai from '../../ai/index.mjs';
const session = ai.session({ source: '每晚自动化', runId: '2026-10-29', module: '04-extract', lane: 'batch' });
const { data, usage } = await session.chat({
  purpose: 'extract',            // 用途：决定发给哪家、哪个模型、扣哪份额度
  messages,                      // 提示词由调用方自己组装
  json: true,                    // 要求返回 JSON，解析不出来自动重试 1 次
  promptVersion: 'extract-v3',   // 记账时一起记下，改提示词后能对照效果
});
```

每晚流程里由总控开好会话，交给模块当 `ctx.ai`；模块只调 `ctx.ai.chat()`。

接口调用成功、但返回的内容调用方用不了时（漏条目、结论不在规定里……），调用方用 `ctx.ai.报告问题({ purpose, promptVersion, 原因 })` 报告，记进用量库的 `problems` 表（不占调用次数），`usage.problemsOf(runId)` 查。接口本身出错不用报告，AI 总管每次调用都自己记了。

## 分发

用途对应哪家接口、哪个模型写在 `common/config.mjs`。换模型、换供应商只改这里，调用方的代码不动。

## 记账

每次调用当场写一行进 `usage.db`，同时把用量交回调用方；按模块、按晚、按天汇总，后台“接口用量”页从这里读。
Codex、Kimi 会员按月订阅：单次费用记 0、token 照记，月费（Codex 150 元、Kimi 199 元）记进固定费用表。

## 现在的状态

5 家接口都已写好并有测试（各文件夹的 `test/`，用假请求、假进程跑，不连真实接口、不花钱）：分发、补位、每天次数、额度、排队、重试、连续失败暂停、JSON 解析、记账汇总都能用。
2026-10-30 在美国服务器上用真实密钥、真实 Codex 试过：5 家 10 项全部通过。试的时候发现 DeepSeek 关思考时要 JSON 会交回坏 JSON，已改成要 JSON 的用途开思考（见 common/config.mjs）。
价格、车道额度等数字待定；Jev 的费用（OpenRouter 返回的 usage.cost）还没记进用量库。
美国服务器现在是 Node 20：正式部署新后端前要升到 Node 22（新后端的数据库库要求），或者在美国服务器上改用 Node 20 能装的版本。

## 还没定的（不影响搭骨架）

实时和批量分不分车道；每晚额度多少；明细和思考过程保存多久；审核、三项核验现在沿用旧系统的 Kimi，以后改不改（Codex 自带搜索 2026-11-06 实测可用，用途 audit 在用）；空壳页重读用 Kimi 还是无头浏览器（现在配的 Kimi）。
