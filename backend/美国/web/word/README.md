# word

只提供函数，由 `读网页` 调用。

- `Word文字(body)` → 文字，段落之间换行；不是 docx、坏文件抛错。docx 是 zip 包，正文在 word/document.xml，用 Node 自带的 zlib 解压，不用第三方库。老式 .doc 不支持。
