# 编码

只提供函数，由 `读网页` 调用。中文网站大量用 GBK，写死 UTF-8 会整页乱码。

- `识别编码(contentType, body)`：先看响应头，再看网页开头的 meta；gb2312 按 gbk；都没写按 utf-8。
- `转文字(body, contentType)`：用 iconv-lite 转。
