// 比赛海报后端（2026-10-24）：只收 16:9；海报 640×360、60 KB 内；图片总库在美国服务器，同步时推到上海换 https 链接
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planPosters, withPosterUrls } from '../scripts/server/sync-public-cache.mjs';

const require = createRequire(import.meta.url);
const poster = require('../apps/miniprogram/cloudfunctions/adminData/posterImage.js');
const { LIST_FIELDS, toListItem } = require('../apps/miniprogram/cloudfunctions/publicData/listFields.js');

// 只有文件头的图片：够读宽高
const jpeg = (width, height, padTo = 0) => {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
  return padTo > head.length ? Buffer.concat([head, Buffer.alloc(padTo - head.length)]) : head;
};
const png = (width, height) => {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20);
  return b;
};
const b64 = buffer => buffer.toString('base64');
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posters-')); });
afterEach(() => { fs.rmSync(dir, { recursive:true, force:true }); });

describe('16:9 判断（误差：宽高比 1.76～1.79）', () => {
  it('1920×1080、1280×720、差一个像素的 1919×1080 都算；正方形、竖图、4:3、21:9 不算', () => {
    expect(poster.isPosterRatio(1920, 1080)).toBe(true);
    expect(poster.isPosterRatio(1280, 720)).toBe(true);
    expect(poster.isPosterRatio(1919, 1080)).toBe(true);
    expect(poster.isPosterRatio(1080, 1080)).toBe(false);
    expect(poster.isPosterRatio(1080, 1920)).toBe(false);
    expect(poster.isPosterRatio(1600, 1200)).toBe(false);
    expect(poster.isPosterRatio(2520, 1080)).toBe(false);
    expect(poster.isPosterRatio(1750, 1000)).toBe(false);
    expect(poster.isPosterRatio(1800, 1000)).toBe(false);
  });
  it('从文件头读宽高：JPG、PNG；读不出来返回 null', () => {
    expect(poster.readImageSize(jpeg(640, 360))).toEqual({ type:'jpg', width:640, height:360 });
    expect(poster.readImageSize(png(1000, 800))).toEqual({ type:'png', width:1000, height:800 });
    expect(poster.readImageSize(Buffer.from('not an image at all, really'))).toBeNull();
  });
});

describe('存进图片总库', () => {
  it('海报：640×360 的 JPG、60 KB 以内才收；文件名是内容哈希', () => {
    const image = jpeg(640, 360, 2000);
    const saved = poster.savePosterImage(b64(image), 'poster', dir);
    expect(saved).toMatchObject({ file:`${sha(image)}.jpg`, width:640, height:360, bytes:2000, ratioOk:true });
    expect(fs.readFileSync(path.join(dir, saved.file))).toEqual(image);
  });
  it('海报：尺寸不对、不是 JPG、超过 60 KB 都拒收', () => {
    expect(() => poster.savePosterImage(b64(jpeg(1280, 720)), 'poster', dir)).toThrow('poster_must_be_640x360');
    expect(() => poster.savePosterImage(b64(png(640, 360)), 'poster', dir)).toThrow('poster_must_be_jpg');
    expect(() => poster.savePosterImage(b64(jpeg(640, 360, 61 * 1024)), 'poster', dir)).toThrow('poster_too_large');
    expect(() => poster.savePosterImage(b64(Buffer.from('xxxxxxxxxxxxxxxxxxxxxxxxxxxx')), 'poster', dir)).toThrow('poster_image_unreadable');
  });
  it('候选：任意比例都收（记下宽高，ratioOk 为 false），5 MB 以内', () => {
    const saved = poster.savePosterImage(`data:image/png;base64,${b64(png(1080, 1920))}`, 'candidate', dir);
    expect(saved).toMatchObject({ width:1080, height:1920, ratioOk:false });
    expect(saved.file).toMatch(/^[0-9a-f]{64}\.png$/);
  });
  it('预览只认总库里的文件名，不能借文件名读别的路径', () => {
    const saved = poster.savePosterImage(b64(jpeg(640, 360)), 'poster', dir);
    expect(poster.readPosterImage(saved.file, dir).dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(() => poster.readPosterImage('../../etc/passwd', dir)).toThrow('poster_file_invalid');
    expect(() => poster.readPosterImage(`${'0'.repeat(64)}.jpg`, dir)).toThrow('poster_file_not_found');
  });
});

describe('公开数据和列表', () => {
  it('公开数据只放海报文件名；文件名格式不对、没有海报都为空；候选图片不进公开数据', () => {
    const file = `${'a'.repeat(64)}.jpg`;
    expect(poster.publicPosterFile({ poster:{ file } })).toBe(file);
    expect(poster.publicPosterFile({ poster:{ file:'../x.jpg' } })).toBe('');
    expect(poster.publicPosterFile({ poster:{ file:`${'a'.repeat(64)}.png` } })).toBe('');
    expect(poster.publicPosterFile({})).toBe('');
  });
  it('列表只多一条 poster_url，不带 poster_file', () => {
    expect(LIST_FIELDS).toContain('poster_url');
    const item = toListItem({ id:'a', name:'比赛', poster_url:'https://x.tcb.qcloud.la/posters/a.jpg', poster_file:'a.jpg' });
    expect(item).toEqual({ id:'a', name:'比赛', poster_url:'https://x.tcb.qcloud.la/posters/a.jpg' });
  });
});

describe('同步时推海报', () => {
  const f1 = `${'1'.repeat(64)}.jpg`; const f2 = `${'2'.repeat(64)}.jpg`; const f3 = `${'3'.repeat(64)}.jpg`;
  it('只推还没推过的；不再用的列为要删；同一张图多场比赛共用只推一次', () => {
    const docs = [{ id:'a', poster_file:f1 }, { id:'b', poster_file:f2 }, { id:'c', poster_file:f2 }, { id:'d', poster_file:'' }];
    const plan = planPosters(docs, { [f1]:{ fileID:'cloud://e/posters/1.jpg' }, [f3]:{ fileID:'cloud://e/posters/3.jpg' } });
    expect(plan.upload).toEqual([f2]);
    expect(plan.stale).toEqual([f3]);
  });
  it('推给上海的数据带上海报的云存储文件 ID（链接由上海返回列表时再换）；还没推成功的先为空', () => {
    const out = withPosterUrls([{ id:'a', poster_file:f1 }, { id:'b', poster_file:f2 }, { id:'c' }], { [f1]:{ fileID:'cloud://e/posters/1.jpg' } });
    expect(out.map(doc => doc.poster_file_id)).toEqual(['cloud://e/posters/1.jpg', '', '']);
  });
});

describe('上海 publicSync：收海报、删海报', () => {
  const file = (buffer) => `${sha(buffer)}.jpg`;
  let calls;
  const load = () => {
    const modulePath = require.resolve('../apps/miniprogram/cloudfunctions/publicSync/index.js');
    delete require.cache[modulePath];
    calls = { upload:[], remove:[] };
    const cloud = {
      init() {}, DYNAMIC_CURRENT_ENV:'env', database:() => ({ command:{} }),
      uploadFile:async args => { calls.upload.push(args); return { fileID:`cloud://env.bucket/${args.cloudPath}` }; },
      getTempFileURL:async ({ fileList }) => ({ fileList:fileList.map(id => ({ fileID:id, tempFileURL:`https://bucket.tcb.qcloud.la/${id.split('/').slice(3).join('/')}` })) }),
      deleteFile:async ({ fileList }) => { calls.remove.push(...fileList); return { fileList:fileList.map(id => ({ fileID:id, status:0 })) }; },
    };
    const previous = Module._load;
    Module._load = function (name, ...args) { return name === 'wx-server-sdk' ? cloud : previous.call(this, name, ...args); };
    try { return require(modulePath).main; } finally { Module._load = previous; }
  };
  const secret = 's'.repeat(32);
  beforeEach(() => { process.env.SYNC_SECRET = secret; });
  afterEach(() => { delete process.env.SYNC_SECRET; });
  it('收 640×360 的 JPG，存到 posters/ 下，返回文件 ID 和 https 链接', async () => {
    const main = load();
    const image = jpeg(640, 360, 3000);
    const result = await main({ secret, action:'uploadPoster', file:file(image), data:b64(image) });
    expect(result).toMatchObject({ ok:true, fileID:`cloud://env.bucket/posters/${file(image)}`, url:`https://bucket.tcb.qcloud.la/posters/${file(image)}` });
    expect(calls.upload[0].fileContent).toEqual(image);
  });
  it('尺寸不对、超 60 KB、文件名和内容对不上、文件名格式不对都不存', async () => {
    const main = load();
    const wrong = jpeg(1280, 720);
    expect((await main({ secret, action:'uploadPoster', file:file(wrong), data:b64(wrong) })).status).toBe('invalid_poster_image');
    const big = jpeg(640, 360, 61 * 1024);
    expect((await main({ secret, action:'uploadPoster', file:file(big), data:b64(big) })).status).toBe('invalid_poster_image');
    const image = jpeg(640, 360);
    expect((await main({ secret, action:'uploadPoster', file:`${'0'.repeat(64)}.jpg`, data:b64(image) })).status).toBe('poster_hash_mismatch');
    expect((await main({ secret, action:'uploadPoster', file:'../x.jpg', data:b64(image) })).status).toBe('invalid_poster_file');
    expect(calls.upload).toHaveLength(0);
  });
  it('只删 posters/ 下按哈希命名的文件；没有密钥一律拒绝', async () => {
    const main = load();
    const ok = `cloud://env.bucket/posters/${'4'.repeat(64)}.jpg`;
    const result = await main({ secret, action:'deletePosters', fileIDs:[ok, 'cloud://env.bucket/other/x.jpg'] });
    expect(result).toMatchObject({ ok:true, removed:1 });
    expect(calls.remove).toEqual([ok]);
    expect((await main({ secret:'wrong', action:'deletePosters', fileIDs:[ok] })).status).toBe('forbidden');
  });
});

describe('比赛记录 → 公开缓存', async () => {
  const { toPublicCache } = require('../apps/miniprogram/cloudfunctions/adminData/publicCache.js');
  const base = {
    id:'edition-1', eventId:'event-1', name:'全国大学生计算机设计竞赛', editionName:'第十九届', eventLevel:'国家级', professions:['计算机与AI'],
    participants:'全日制在校本科生', eligibility:'须具有学籍', organizer:'测试组委会',
    participationFormat:'团队赛', teamSizeCategory:'2～3人', feeType:'免费', registrationOrganization:'自行报名', registrationUrl:'https://example.com/r',
    schedule:{ registration_start:'2026-08-01T00:00:00.000Z', registration_end:'2026-09-30T00:00:00.000Z', status_override:null },
    recommendation:{ recommendation:'值得参加', reasons:['官方资料完整'] }, lastVerifiedAt:'2026-08-30T00:00:00.000Z',
    sources:[{ id:'source-1', source_type:'authority_notice', is_official:true, validity_status:'valid', url:'https://example.com/notice', last_verified_at:'2026-08-30T00:00:00Z', title:'正式通知', content_summary:'当届安排', evidence_excerpt:'报名时间', supports_fields:['赛事名称'], review_reason:'已核对' }],
    dataStatus:'published', systemValidation:'passed', manualReview:'passed',
  };
  const NOW = new Date('2026-08-31T00:00:00.000Z');
  it('有海报带文件名；没有海报为空；候选图片不进公开缓存', () => {
    const file = `${'b'.repeat(64)}.jpg`;
    const withPoster = toPublicCache({ ...base, poster:{ file, source:'manual', sourceUrl:'', updatedAt:'2026-10-24T00:00:00Z' }, posterCandidates:[{ file:`${'c'.repeat(64)}.png` }] }, NOW);
    expect(withPoster.poster_file).toBe(file);
    expect(JSON.stringify(withPoster)).not.toContain('c'.repeat(64));
    expect(toPublicCache(base, NOW).poster_file).toBe('');
  });
});

describe('上海 publicData：返回列表时把文件 ID 换成链接', () => {
  const { fillPosterLinks, clearPosterLinkCache, LINK_TTL_MS } = require('../apps/miniprogram/cloudfunctions/publicData/posterLinks.js');
  const id = n => `cloud://env.bucket/posters/${String(n).repeat(64).slice(0, 64)}.jpg`;
  const fakeCloud = () => {
    const calls = [];
    return { calls, getTempFileURL:async ({ fileList }) => { calls.push(fileList); return { fileList:fileList.map(fileID => ({ fileID, status:0, tempFileURL:`https://b.tcb.qcloud.la/${fileID.slice(-10)}?sign=x` })) }; } };
  };
  beforeEach(() => clearPosterLinkCache());
  it('一页里的文件 ID 一次换好，填进 poster_url；没有海报的为空；不改原来的条目', async () => {
    const cloud = fakeCloud();
    const items = [{ id:'a', poster_file_id:id(1) }, { id:'b', poster_file_id:id(2) }, { id:'c', poster_file_id:'' }, { id:'d', poster_file_id:id(1) }];
    const out = await fillPosterLinks(items, cloud, 1000);
    expect(cloud.calls).toEqual([[id(1), id(2)]]);
    expect(out.map(item => Boolean(item.poster_url))).toEqual([true, true, false, true]);
    expect(items[0]).not.toHaveProperty('poster_url');
  });
  it('8 分钟内用缓存不再调接口；过了 8 分钟重新换（链接 10 分钟失效）', async () => {
    const cloud = fakeCloud();
    await fillPosterLinks([{ poster_file_id:id(3) }], cloud, 0);
    await fillPosterLinks([{ poster_file_id:id(3) }], cloud, LINK_TTL_MS - 1);
    expect(cloud.calls).toHaveLength(1);
    await fillPosterLinks([{ poster_file_id:id(3) }], cloud, LINK_TTL_MS + 1);
    expect(cloud.calls).toHaveLength(2);
  });
  it('超过 50 个分批换；换链接失败不影响列表；美国服务器没有这个接口时原样返回', async () => {
    const cloud = fakeCloud();
    await fillPosterLinks(Array.from({ length:60 }, (_, n) => ({ poster_file_id:`cloud://env.bucket/posters/${n.toString(16).padStart(64, '0')}.jpg` })), cloud, 0);
    expect(cloud.calls.map(batch => batch.length)).toEqual([50, 10]);
    const broken = { getTempFileURL:async () => { throw new Error('down'); } };
    expect((await fillPosterLinks([{ id:'x', poster_file_id:id(5) }], broken, 0))[0].poster_url).toBe('');
    const items = [{ id:'y' }];
    expect(await fillPosterLinks(items, {}, 0)).toBe(items);
  });
});
