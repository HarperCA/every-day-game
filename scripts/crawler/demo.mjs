// 抓取层演示：对给定 URL 走一遍完整流程，打印返回结构。
// 用法：node demo.mjs <url>
import { Fetcher } from './lib/fetcher.mjs';
import { extractPdfText, extractText, extractTitle, findImages, findNoticeLinks } from './lib/extract.mjs';

const url = process.argv[2];
if (!url) {
  console.error('用法: node demo.mjs <url>');
  process.exit(1);
}

const fetcher = new Fetcher({ cacheDir: './cache' });
const started = Date.now();
const page = await fetcher.get(url);

const out = {
  请求: { url: page.url, 最终地址: page.finalUrl, 状态: page.status, HTTP: page.httpStatus },
  内容: { 类型: page.contentType, 编码: page.charset, 字节: page.bytes, 耗时毫秒: Date.now() - started },
};

if (page.isBinary && /pdf/i.test(page.contentType || '')) {
  const pdf = await extractPdfText(page.body);
  out.PDF = { 状态: pdf.status, 页数: pdf.pages, 正文字符: pdf.text.length, 正文前200字: pdf.text.slice(0, 200) };
} else if (page.text) {
  const text = extractText(page.text);
  const links = findNoticeLinks(page.text, page.finalUrl || url);
  out.标题 = extractTitle(page.text);
  out.正文 = { 原始字符: page.text.length, 提取后字符: text.length, 前300字: text.slice(0, 300) };
  out.发现的通知链接 = links.slice(0, 3).map(l => ({ 评分: l.score, PDF: l.isPdf, 标题: l.text, 地址: l.url }));
  const images = findImages(page.text, page.finalUrl || url);
  out.发现的图片 = images.map(i => ({ 评分: i.score, 说明: i.alt, 尺寸: i.width ? `${i.width}x${i.height}` : '未标注', 地址: i.url }));
}

out.抓取统计 = fetcher.stats;
console.log(JSON.stringify(out, null, 2));
