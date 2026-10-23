// 服务器侧批量抽取。
//
// 为什么不放在云函数里：云函数有 60 秒硬上限，实测单次抽取 41-50 秒，
// 余量只有十秒，第一次调用就超时失败过。批量跑几百条时这个余量撑不住。
// 服务器没有这个限制，同一份抽取模块在这里可以给模型更充裕的时间。
//
// 部署位置：/opt/daily-contest/run-extract.mjs
// 抽取模块：/opt/daily-contest/cjs/（云函数那几个 CJS 文件的副本，
//          服务器 package.json 是 type:module，所以必须放在带自己
//          package.json 的子目录里）
// 密钥：/opt/daily-contest/.extract-key，单行纯文本，chmod 600
//
// 用法：node run-extract.mjs --in candidates.json [--limit 3] [--out report.json]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { baiduEngine, createSearcher, deepseekEngine, kimiEngine, kimiFetchPage } from './search-engines.mjs';
import { createPageReader } from './page-reader.mjs';
import { fieldsFromImages, findNoticeTitles, findPoster, imageCandidates, keyFieldCount, missingKeyFields, ocrImage, ocrRelevance, pickOfficialNotice } from './page-supplement.mjs';

// 服务器部署时 crawler/ 在脚本旁；仓库里则是 scripts/crawler/。
const crawlerModule = name => import(`./crawler/lib/${name}.mjs`).catch(() => import(`../crawler/lib/${name}.mjs`));
const [{ Fetcher }, { extractDocxText, extractPdfText, extractText, findNoticeLinks }, { evidenceLinks, rankEvidenceLinks }] = await Promise.all([
  crawlerModule('fetcher'), crawlerModule('extract'), crawlerModule('jevLinkRanker'),
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(HERE, '.extract-key');
const CJS_DIR = path.join(HERE, 'cjs');

// 密钥只从文件读，不接受命令行参数 —— 命令行会进 shell 历史。
function readKey() {
  if (!fs.existsSync(KEY_FILE)) throw new Error(`缺少密钥文件 ${KEY_FILE}`);
  const key = fs.readFileSync(KEY_FILE, 'utf8').trim();
  if (!key) throw new Error(`密钥文件 ${KEY_FILE} 是空的，请先写入`);
  return key;
}

const require = createRequire(import.meta.url);

// 服务器没有 60 秒上限，给模型更充裕的时间；仍然设上限，避免单条卡死拖垮整批。
// 2026-09-30 测试阶段打开了 DeepSeek 的思考（cjs/aiReasoning.js），一条要多想几十秒，放宽到 5 分钟。
// 思考过程随结果写进 --out 文件（每条结果的 reasoning 字段），后台“抓取结果账”明细里可以展开看。
const SERVER_BUDGET_MS = 300000;
const PER_CALL_DELAY_MS = 1200;
const USER_AGENT = 'competition-crawler/1.0 (+admin source verification; respects robots.txt)';
const evidenceFetcher = new Fetcher({ perHostDelayMs:1500 });
// 空壳页（前后端分离的官网，直接下载只有导航骨架）用 Kimi 读网页接口重读，每轮最多这么多条（2026-10-01，用户定）
const MAX_RENDERED_REREADS = 20;
let renderedRereads = 0;
// 关键信息（参赛对象、报名时间）还缺时的补读（page-supplement.mjs）：每轮最多补读这么多条；
// 找正式通知用的搜索也按百度 → Kimi → DeepSeek 依次补位，额度单独算，不占通知追溯的
const MAX_SUPPLEMENTS = 20;
let supplements = 0;
const noticeSearcher = createSearcher([{ engine:baiduEngine({ caller:'formal-notice' }), budget:0 }, { engine:kimiEngine(), budget:10 }, { engine:deepseekEngine(), budget:10 }]);
const PAGE_LIMIT = 6000; // 抽取模块只看正文前 6000 字（competitionExtract.js 的 PAGE_TEXT_LIMIT）
const POSTER_MAX_CANDIDATES = 3;
const POSTER_TIMEOUT_MS = 8000;

// 读一个网页的正文：先直接读（遵守 robots），只有骨架时再用 Kimi 读网页接口；PDF、Word 附件也能读（page-reader.mjs，和通知追溯共用）
const readPageText = createPageReader({ fetcher:evidenceFetcher, extract:{ extractText, extractPdfText, extractDocxText, findNoticeLinks }, maxChars:8000 });

function readOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const file = path.join(HERE, '.openrouter-key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim().replace(/^OPENROUTER_API_KEY=/, '');
  const envFile = path.resolve(HERE, '..', '..', '.env');
  const line = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m) : null;
  return line?.[1]?.trim() || '';
}

function parseArgs(argv) {
  const args = { in:'', out:'', limit:0 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') args.in = argv[i + 1];
    if (argv[i] === '--out') args.out = argv[i + 1];
    if (argv[i] === '--limit') args.limit = Number(argv[i + 1]) || 0;
  }
  if (!args.in) throw new Error('必须指定 --in <候选文件>');
  args.out = args.out || args.in.replace(/\.json$/, '') + '-extracted.json';
  return args;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 「什么都没抽到」：没有主办方、没有权威信号、也没有任何回报。
// 这要么是正文真的没写，要么是模型这一次抖了 —— 重试一次就能分辨。
function yieldedNothing(outcome) {
  const extracted = outcome?.extracted;
  if (!extracted) return true;
  return !extracted.organizer
    && !(extracted.authority_signals || []).length
    && !(extracted.reward_highlights || []).length;
}

// 天池详情页是前后端分离的，静态抓取只有导航骨架（实测两个不同赛事抓出来
// 一字不差）。正文要走它自己的接口取，再经 text 传给抽取模块。
async function tianchiText(raceId) {
  const response = await fetch(
    `https://tianchi.aliyun.com/v3/proxy/competition/api/race/getDetail?raceId=${raceId}`,
    { headers:{ 'user-agent':USER_AGENT }, signal:AbortSignal.timeout(20000) },
  );
  if (!response.ok) return '';
  const race = (await response.json())?.data?.race || {};
  return [race.name, race.introduction, race.rule, race.reward, race.currentSeason?.rule, race.currentSeason?.reward]
    .filter(value => typeof value === 'string').join('\n');
}

// 平台条目（如辽宁省大学生创新创业平台）：详情接口返回的是数据不是网页，正文常常只有“详见附件”，
// 参赛对象、资格、赛制都在附件通知里。用来源脚本整理好的正文，再读最多 4 个 PDF / Word 附件。
async function platformText(candidate) {
  const sections = [`来源：${candidate.evidence?.source || '平台'}（${candidate.detailUrl}）
${candidate.introduction || ''}`];
  const files = (candidate.attachmentFiles || []).filter(file => /\.(pdf|docx)$/i.test(file.name || '')).slice(0, 4);
  for (const file of files) {
    const page = await evidenceFetcher.get(file.url);
    const buffer = page.body;
    if (page.status !== 'ok' || !buffer?.length) { sections.push(`附件《${file.name}》读取失败：${page.status}`); continue; }
    const head = buffer.subarray(0, 4).toString('latin1');
    const parsed = head.startsWith('%PDF') ? await extractPdfText(buffer, { maxChars:9000 }) : head.startsWith('PK') ? extractDocxText(buffer, { maxChars:9000 }) : { text:'', status:'unknown_format' };
    sections.push(parsed.text ? `附件《${file.name}》正文：
${parsed.text}` : `附件《${file.name}》未能读出文字：${parsed.status}`);
  }
  return sections.join('\n\n').slice(0, 30000);
}

// 官网直接给出 PDF / DOCX 正文时，也应走和平台附件相同的文本抽取。
// 文本前缀保留可复核的原网址，后续仍须经过抽取模块的逐字引文回查。
export async function binarySourceText(page, url, { pdf = extractPdfText, docx = extractDocxText } = {}) {
  const body = page?.body;
  if (page?.status !== 'ok' || !body?.length) return '';
  const head = body.subarray(0, 4).toString('latin1');
  const parsed = head.startsWith('%PDF') ? await pdf(body, { maxChars:30000 })
    : head.startsWith('PK') ? docx(body, { maxChars:30000 }) : null;
  return parsed?.text ? `来源文件：${page.finalUrl || url}\n${parsed.text}` : '';
}

// 按站点决定怎么取正文。取不到就返回空串，让抽取模块自己去抓页面。
async function sourceTextFor(candidate) {
  const url = String(candidate.detailUrl || candidate.url || '');
  // 只认布尔 true（辽宁平台脚本写的）：百度、天池、DataFountain 的 evidence.api 是接口网址字符串，不能走这条路
  if (candidate.evidence?.api === true) return platformText(candidate);
  const tianchi = /tianchi\.aliyun\.com\/competition\/entrance\/(\d+)/.exec(url);
  if (tianchi) {
    try {
      return await tianchiText(tianchi[1]);
    } catch (error) {
      return '';
    }
  }
  // 普通网站先抓页面，再对报名/章程/组织机构链接排序并读取最多 3 个。
  // Fetcher 负责 robots、频率、大小与最终跳转；不把未经验证的链接标为官网。
  const page = await evidenceFetcher.get(url);
  if (page.status !== 'ok') return '';
  if (!/html/i.test(page.contentType || '')) return binarySourceText(page, url);
  candidate.pageHtml = page.text;
  // 顺便找赛事海报：官网声明的封面图，没有再找页面上的赛事大图；都没有就留空（page-supplement.mjs 的 findPoster）。
  // 每晚有 3 小时上限：页面大图最多量 3 张、每张等 8 秒，单条最坏多花约 30 秒；补不全的由 backfill-posters.mjs 慢慢补
  const poster = await findPoster({ html:page.text, pageUrl:page.finalUrl || url, contestName:String(candidate.name || '') },
    { maxCandidates:POSTER_MAX_CANDIDATES, timeoutMs:POSTER_TIMEOUT_MS }).catch(() => null);
  candidate.posterUrl = poster?.url || '';
  candidate.posterSource = poster?.source || '';
  const links = evidenceLinks(page.text, page.finalUrl || url);
  const ranked = await rankEvidenceLinks(links, { apiKey:readOpenRouterKey(), contestName:String(candidate.name || '') });
  candidate.discoveredEvidence = ranked;
  const sections = [`来源页面：${page.finalUrl || url}\n${extractText(page.text, { maxChars:14000 })}`];
  let followed = 0;
  for (const link of ranked) {
    if (followed >= 3) break;
    if (link.kind === 'other') continue;
    if (link.status === 'ranked' && link.probability < 0.8) continue;
    const linkedPage = await evidenceFetcher.get(link.url);
    link.fetchStatus = linkedPage.status;
    link.finalUrl = linkedPage.finalUrl || link.url;
    if (linkedPage.status !== 'ok' || !/html/i.test(linkedPage.contentType || '')) continue;
    sections.push(`链接类型：${link.kind}；链接文字：${link.label}；实际网址：${link.finalUrl}\n${extractText(linkedPage.text, { maxChars:8000 })}`);
    followed += 1;
  }
  return sections.join('\n\n').slice(0, 30000);
}

async function main() {
  // 抽取模块读取环境变量；保持 CLI 行为，同时允许单测导入纯文本处理函数。
  process.env.EXTRACT_AI_API_KEY = readKey();
  process.env.EXTRACT_AI_BASE_URL = process.env.EXTRACT_AI_BASE_URL || 'https://api.deepseek.com';
  process.env.EXTRACT_AI_MODEL = process.env.EXTRACT_AI_MODEL || 'deepseek-flash';
  const { extractFromDetailPage } = require(path.join(CJS_DIR, 'competitionExtract.js'));
  const args = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(await fsp.readFile(path.resolve(HERE, args.in), 'utf8'));
  const candidates = (payload.candidates || payload.new || payload).slice(0, args.limit || undefined);

  console.log(`供应商 ${process.env.EXTRACT_AI_MODEL} @ ${process.env.EXTRACT_AI_BASE_URL}`);
  console.log(`待抽取 ${candidates.length} 条\n`);

  const results = [];
  for (const [index, candidate] of candidates.entries()) {
    const url = String(candidate.detailUrl || candidate.url || '');
    const name = String(candidate.name || candidate.candidate || '');
    const started = Date.now();
    let outcome;
    let retried = false;
    const runOnce = async text => {
      try {
        return await extractFromDetailPage(url, undefined, {
          contestName:name, text, totalBudgetMs:SERVER_BUDGET_MS, chatTimeoutMs:SERVER_BUDGET_MS,
        });
      } catch (error) {
        // 单条失败不能中断整批 —— 其余候选仍然值得跑完。
        return { ok:false, status:'threw', url, error:String(error?.message || error).slice(0, 300) };
      }
    };
    let text = '';
    try { text = await sourceTextFor(candidate); }
    catch (error) { candidate.evidenceDiscoveryError = String(error?.message || error).slice(0, 180); }
    outcome = await runOnce(text);
    // 空壳页：我们的抓取已经确认 robots 允许、但只拿到导航骨架。用 Kimi 读网页接口（服务端执行脚本）重读一次。
    // 平台条目（天池、辽宁平台）走各自的接口，不在此列。重读到的正文同样要过引文回查，证据仍然可复核。
    let rendered = null;
    if (!outcome.ok && outcome.status === 'page_is_boilerplate' && candidate.evidence?.api !== true && !/tianchi\.aliyun\.com/.test(url)
      && renderedRereads < MAX_RENDERED_REREADS) {
      renderedRereads += 1;
      try {
        const page = await kimiFetchPage(url);
        rendered = { via:'kimi_fetch', chars:page.markdown.length, ms:page.ms, before:outcome.sourceChars ?? null };
        candidate.renderedImages = page.images || [];
        if (page.markdown.length >= 200) {
          const second = await runOnce(`来源页面（原站内容由脚本加载，经 Kimi 读网页接口执行脚本后取得正文）：${url}\n${page.markdown}`);
          rendered.status = second.ok ? 'ok' : second.status;
          if (second.ok || second.status !== 'page_is_boilerplate') { outcome = second; text = page.markdown; }
        } else {
          rendered.status = 'too_short';
        }
      } catch (error) {
        rendered = { via:'kimi_fetch', status:'error', error:String(error?.message || error).slice(0, 160) };
      }
    }
    // 抽取结果不稳定：实测「跨本体具身」这条批量跑时什么都没抽到，
    // 单独连跑两次却都正确抽出了主办单位和四条权威信号。同样的输入、不同的输出。
    // 一次调用只要一秒多、约一分钱，抽空了就重试一次远比让一个好赛事
    // 因为一次掷硬币停在待审要划算。
    if (outcome.ok && yieldedNothing(outcome)) {
      retried = true;
      await sleep(PER_CALL_DELAY_MS);
      const second = await runOnce(text);
      if (second.ok && !yieldedNothing(second)) outcome = second;
    }
    // 关键信息（参赛对象、报名时间）还缺：① 按页面里的公告标题找官网正式通知（文字，可逐字核对，优先）；
    // ② 仍缺的，识别页面上的大图。靠图片补出来的项记在 imageEvidenceFields，入库时整条转人工审核。
    let supplement = null;
    if (outcome.ok && text && missingKeyFields(outcome.extracted).length && supplements < MAX_SUPPLEMENTS && candidate.evidence?.api !== true) {
      supplements += 1;
      supplement = { missingBefore:missingKeyFields(outcome.extracted) };
      const baseText = text.slice(0, PAGE_LIMIT);
      let pageText = baseText;
      try {
        for (const title of findNoticeTitles(baseText, name)) {
          const found = await noticeSearcher.search(title);
          const notice = found && !found.failed ? pickOfficialNotice(found.references, url, title) : null;
          supplement.notice = { title, engine:found?.label || '', returned:found?.references?.length ?? 0, url:notice?.url || '', status:notice ? 'found' : found ? 'not_on_official_site' : 'no_search_quota' };
          if (!notice) continue;
          const read = await readPageText(notice.url);
          supplement.notice.read = read.status;
          supplement.notice.via = read.via || '';
          if (read.status !== 'ok') continue;
          const combined = `来源：官网公告《${title}》 ${notice.url}\n${read.text.slice(0, 3800)}\n\n来源：官网页面 ${url}\n${baseText.slice(0, 2000)}`;
          const second = await runOnce(combined);
          if (second.ok && keyFieldCount(second.extracted) > keyFieldCount(outcome.extracted)) {
            outcome = second; pageText = combined; supplement.notice.used = true;
          }
          break;
        }
      } catch (error) { supplement.noticeError = String(error?.message || error).slice(0, 160); }
      if (missingKeyFields(outcome.extracted).length) {
        try {
          const images = imageCandidates({ html:candidate.pageHtml, pageUrl:url, renderedImages:candidate.renderedImages });
          // 最多识别 8 张；识别出的文字按和“参赛对象、报名时间”的相关程度排序，广告横幅（福利、折扣、扫码）排后面、
          // 不相关的不要——实测官网首页前几张是广告横幅，按顺序取会把报名卡片、日程图挤掉（2026-10-03）
          const texts = [];
          for (const imageUrl of images.slice(0, 8)) {
            const ocr = await ocrImage(imageUrl);
            if (ocr && ocrRelevance(ocr) > 0) texts.push({ imageUrl, text:ocr, score:ocrRelevance(ocr) });
          }
          texts.sort((a, b) => b.score - a.score);
          supplement.images = { tried:Math.min(images.length, 8), recognized:texts.length };
          if (texts.length) {
            const ocrText = texts.map((item, i) => `图片${i + 1}：${item.text}`).join('\n').slice(0, 1800);
            const combined = `${pageText.slice(0, PAGE_LIMIT - ocrText.length - 60)}\n\n【以下文字由官网页面上的图片识别得到，不是网页正文】\n${ocrText}`;
            const third = await runOnce(combined);
            if (third.ok && keyFieldCount(third.extracted) > keyFieldCount(outcome.extracted)) {
              outcome = { ...third, imageEvidenceFields:fieldsFromImages(third.extracted, pageText, ocrText) };
              supplement.images.used = true;
              supplement.images.fields = outcome.imageEvidenceFields;
            }
          }
        } catch (error) { supplement.imageError = String(error?.message || error).slice(0, 160); }
      }
      supplement.missingAfter = outcome.ok ? missingKeyFields(outcome.extracted) : supplement.missingBefore;
    }
    const elapsed = Date.now() - started;
    results.push({ name, url, elapsedMs:elapsed, retried, posterUrl:candidate.posterUrl || '', posterSource:candidate.posterSource || '', discoveredEvidence:candidate.discoveredEvidence || [], evidenceDiscoveryError:candidate.evidenceDiscoveryError || null, ...(rendered ? { rendered } : {}), ...(supplement ? { supplement } : {}), ...outcome });
    const thought = outcome.reasoning?.chars ? ` 思考${outcome.reasoning.chars}字` : '';
    const suffix = (outcome.ok
      ? `建议${outcome.suggestions?.length ?? 0}条 丢弃${outcome.droppedCount ?? 0}条`
      : `失败 ${outcome.status}`) + thought;
    const retryMark = (retried ? ' (重试)' : '') + (rendered ? ` (空壳页经 Kimi 重读：${rendered.status}${rendered.chars ? `，${rendered.chars}字` : ''})` : '')
      + (supplement ? ` (补读：缺${supplement.missingBefore.join('、')}${supplement.notice?.used ? '，正式通知已补' : ''}${supplement.images?.used ? `，图片识别补了${(supplement.images.fields || []).join('、') || '若干项'}` : ''}${supplement.missingAfter.length ? `，仍缺${supplement.missingAfter.join('、')}` : '，已补齐'})` : '');
    console.log(`[${index + 1}/${candidates.length}] ${String(elapsed).padStart(6)}ms  ${suffix}${retryMark}  ${name.slice(0, 30)}`);
    if (index < candidates.length - 1) await sleep(PER_CALL_DELAY_MS);
  }

  const ok = results.filter(item => item.ok);
  const report = {
    generatedAt:new Date().toISOString(),
    model:process.env.EXTRACT_AI_MODEL,
    baseUrl:process.env.EXTRACT_AI_BASE_URL,
    policy:'抽取只产出建议，不写库。每条建议都带回原文定位得到的引文。',
    total:results.length,
    succeeded:ok.length,
    medianElapsedMs:ok.length
      ? ok.map(item => item.elapsedMs).sort((a, b) => a - b)[Math.floor(ok.length / 2)]
      : null,
    totalDropped:ok.reduce((sum, item) => sum + (item.droppedCount || 0), 0),
    retriedCount:results.filter(item => item.retried).length,
    results,
  };
  const outPath = path.resolve(HERE, args.out);
  await fsp.writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`\n成功 ${ok.length}/${results.length}  中位耗时 ${report.medianElapsedMs}ms  累计丢弃 ${report.totalDropped} 条`);
  console.log(`写入 ${outPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => {
    console.error('批量抽取失败:', error.message);
    process.exit(1);
  });
}
