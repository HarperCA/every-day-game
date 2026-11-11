# 代读网页（沟通/代读网页）

**方向**：美国 → 北京 → 国内网站

美国维护读网页时，政府、学校这类国内网站从美国访问不稳。2026-11-09 用户定：**是网络问题读不到时，让北京服务器去读，读完传回美国**。

## 现在的状态

能用（2026-11-09），还没部署。

| 文件 | 跑在哪 | 做什么 |
|---|---|---|
| 北京端.mjs | 北京服务器 | 只听本机的小服务（端口 `BEIJING_FETCH_PORT`，默认 4334），nginx 把 `/sync/fetch` 转进来；验签后用 `美国/web` 的 读网页、取源码读，结果交回 |
| 美国端.mjs | 美国服务器 | `代读(网址, 选项)`：签名请求北京，交回和 读网页 / 取源码 一样的格式；出错不抛 |

什么时候改请北京由 `美国/web/读网页/北京兜底.mjs` 的 `带北京兜底` 决定；新维护在 `美国/db/新维护/运行.mjs` 里接上（见下）。

## 格式

请求（美国 → 北京）：`POST /sync/fetch`，正文 `{ 网址, 方式: '网页' | '源码', etag?, 最后修改? }`，带 `x-sync-time`、`x-sync-signature`（HMAC-SHA256(时间.正文)，同步秘钥 `SYNC_SECRET`），北京只认 5 分钟以内的。签名和公开比赛同步同一套（`../公开比赛同步/格式.mjs`）。

北京回：
- 200 `{ ok: true, 结果 }`：方式“网页”的 结果 和 `读网页()` 一样（`{ url, finalUrl, status, httpStatus, contentType, title, text, links, error, ms, fetchedAt }`）；“源码”的和 `取源码()` 一样（`{ url, finalUrl, status, httpStatus, html, etag, 最后修改, error }`，给了 etag、最后修改就带着去问，网站回 304 交回“没更新”）。北京读不到（不安全、robots 不允许、超时……）也是 200，原因在 结果 里。
- 401 `sync_signature_invalid` / `sync_expired`；405；400 `invalid_json`；422 `invalid_url` / `invalid_mode` / `invalid_version_tag`；413 请求超过 16KB；500 读的时候程序出错。

美国端 `代读(网址, { 方式, etag, 最后修改, endpoint, 秘钥, fetchImpl, signal, 超时 })`：北京读到什么原样交回；没配地址或秘钥、连不上、60 秒没回、北京不收、交回的不是结果时，交回对应格式、状态“网络错误”、error 以“北京代读失败：”开头的结果。

## 安全规则（和美国同一份代码）

北京端直接引用 `美国/web/index.mjs` 的 读网页、取源码，所以规范化网址、只读公网 http/https（内网、本机、云内部地址拒绝，跳转后每一跳也查）、robots、爬虫身份（user-agent）、同一网站间隔 1.5 秒、读正文和 PDF、Word 都和美国一样。上限比美国紧：**15 秒、3MB、最多 5 次跳转**（`上限`）。

为什么不是把安全检查挪到 `共用/工具/`：北京要交回和读网页一样的结果，光有安全检查不够，还要下载、robots、编码、正文、PDF、Word 整套；把这些都挪走改动大，而且 `美国/web` 里有别的会话没提交的改动。所以只在 `沟通/test/单独/structure.test.mjs` 里开了一个口子：**只有 `沟通/代读网页/` 能引用 `美国/web/index.mjs`**。

## 什么时候改走北京（带北京兜底）

`带北京兜底({ 读网页, 取源码, 代读 })` → `{ 读网页, 取源码 }`，参数和格式不变：

- 改请北京一次：超时、网络错误（连接被重置、连不上、域名解析失败、证书错误都算这个）、HTTP错误里的 403 和 5xx。
- 不改走北京：成功、没更新(304)、404 等其余 HTTP 错误、跳转太多、太大、不支持的类型、robots 不允许、内网地址、正文太短、读不出文字、内部错误；调用方已经喊停也不请。
- 北京给了不是网络问题的答复（成功、没更新、正文太短、404……）就用北京的，结果加 `经北京: true`；北京也是网络问题或代读失败，交回原来的失败结果，error 后补“；北京也没读到：…”。
- **无头浏览器不经北京**（北京没装浏览器）。

## 接进新维护

`美国/db/新维护/运行.mjs` 的 `接北京兜底`：环境里有 `BEIJING_FETCH_ENDPOINT` 和同步秘钥（`SYNC_SECRET`，或 `SYNC_SECRET_FILE` 指的文件）时，读网页、取源码用 带北京兜底 包上；缺一个就照旧。新维护不能直接引用 `沟通/`，所以 `代读` 经 `美国/web/index.mjs` 转出去。每晚寻找流程还没接。

## 部署要做的

北京：
1. 打包时**加上 `美国/web`**（不带 test）。北京现在只打包 北京、共用、沟通、Environment，不加的话服务一启动就因为找不到 `美国/web/index.mjs` 退出。依赖（cheerio、iconv-lite、pdf-parse）已经在 `Environment/package.json` 里，不用装浏览器。
2. 加一个 systemd 服务（照 `北京/部署/competition-radar-review-receiver.service` 抄），`ExecStart=/usr/bin/node --preserve-symlinks-main /opt/competition-radar/backend/沟通/代读网页/北京端.mjs`；`beijing.env` 里加 `BEIJING_FETCH_PORT=4334`（不加也默认 4334），秘钥用已有的 `SYNC_SECRET_FILE`。
3. nginx 加一段（只放美国服务器的 IP，和 `/sync/review` 一样）：

```nginx
location = /sync/fetch {
    allow 107.175.111.18;
    deny all;
    client_max_body_size 16k;
    proxy_read_timeout 60s;
    proxy_pass http://127.0.0.1:4334;
}
```

美国（跑新维护的环境）加两个环境变量：
- `BEIJING_FETCH_ENDPOINT=https://xiaohuiworks.cn/sync/fetch`（和 `美国/部署/env.example` 里 `SYNC_REVIEW_ENDPOINT` 同一个域名）
- `SYNC_SECRET_FILE`（或 `SYNC_SECRET`）：和别的同步同一把秘钥。

## 规矩

两端放在同一个文件夹里，格式和密钥规则只定一次；只走服务器之间，不经过小程序。
