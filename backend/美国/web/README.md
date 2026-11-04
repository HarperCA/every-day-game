# 抓网页（美国/web）

只做一件事：读网页。寻找流程（`pipeline/`）和维护（`维护/`）都要读网页，所以放在美国下一级，两边都只通过 `index.mjs` 用。
读出来以后怎么用（补读附件、截短给 Codex、取核验片段、比对公告栏）由用到它的模块自己写函数，不放在这里（2026-11-01 用户定）。

```
web/
  index.mjs   唯一入口：读网页
  读网页/     总函数：统一管整个流程；网址规范化、安全检查、同一网站限速、统一的结果格式也在这里
  下载/       下载（超时、跳转、大小、类型）和 robots 检查，只提供函数
  编码/       识别编码（GBK、UTF-8）、转成文字，只提供函数
  正文/       网页的标题、正文、链接，只提供函数
  pdf/        PDF 文字，只提供函数
  word/       Word（docx）文字，只提供函数
  test/
```

## 读网页

`读网页(网址, { signal, 最少字数 })` → `{ url, finalUrl, status, httpStatus, contentType, title, text, links: [{ url, text, kind }], error, ms, fetchedAt }`

流程：规范化网址 → 安全检查（只读公网 http/https）→ robots → 同一网站限速（默认间隔 1.5 秒，进程里共用）→ 下载（每次跳转前再查安全和 robots）→ 按文件内容判断类型 → 网页取标题、正文、链接；PDF、Word 读文字 → 正文不到 300 字记“正文太短”。

状态：成功、网址不安全、robots不允许、HTTP错误、超时、太大、不支持的类型、读不出文字、正文太短、网络错误、内部错误。每一步出问题都交回对应状态和原因，不抛错。超时、网络错误、对方 5xx 下一晚可以再试（`isRetryable`）。

只用自己的程序读，不交给 Kimi，也没有中转（2026-11-01 用户定：先做最简单的，按记下的状态看空壳页和读不通的多不多，再决定加不加）。

## 搬自哪里

| 块 | 旧代码 |
|---|---|
| 下载 | `scripts/crawler/lib/fetcher.mjs` 的 getDirect、`urlPolicy.mjs` 的 readLimitedBody |
| robots | `cloudfunctions/adminData/robots.js` 的规则，`fetcher.mjs` 的 loadRobots |
| 编码 | `fetcher.mjs` 的 detectCharset、decodeBody |
| 正文 | `crawler/lib/extract.mjs` 的 extractText、extractTitle、findNoticeLinks |
| pdf、word | `extract.mjs` 的 extractPdfText、extractDocxText |

用到的库（装在 `backend/Environment/`，版本和旧代码一样）：cheerio 1.0.0-rc.12、iconv-lite 0.6.3、pdf-parse 1.1.1。

没搬的：12 小时缓存、上海中转、北京读网页。

## 发现的问题

pdf-parse 带的旧版 pdf.js 不认 Node 小 Buffer 的起点（从共用内存里切出来的，起点不在 0），会读到错位的字节，报“bad XRef entry”，文件越小越容易碰上。新代码先复制一份再交给它；旧代码 `extractPdfText` 是直接交的，线上可能有小 PDF 一直读不出文字。
