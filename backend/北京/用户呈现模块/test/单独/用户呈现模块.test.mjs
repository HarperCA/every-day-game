// 用户呈现模块：小程序首页列表的整条流程。用户输入 → 排序工具（读主数据库、副数据库，交给排序规则）→ 返回（分页、卡片字段）。
// 标准答案（test/复用/首页样例.json）是 2026-11-01 用旧代码（publicQuery 的面板筛选 + listOrder + personalizePage + listFields.slimListV2）
// 在同样的比赛、同样的请求下算出来的；只有规则 ① 那一处按规则改过（见 共用/推荐排序/README.md）。
// 返回的卡片沿用旧字段名，现在的小程序不用改就能接。用内存里的库跑。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { openMainDb, 同步, 海报 } from '../../../主数据库/index.mjs';
import { 假JPG } from '../../../../共用/test/复用/假图片.mjs';
import { 内容哈希 } from '../../../../共用/工具/图片.mjs';
import { openUserDb, 用户, 收藏, 提醒 } from '../../../副数据库/index.mjs';
import { 呈现首页 } from '../../index.mjs';
import { 整理输入 } from '../../用户输入/index.mjs';

const 样例 = JSON.parse(fs.readFileSync(new URL('../复用/首页样例.json', import.meta.url), 'utf8'));
const now = new Date('2026-11-01T04:00:00Z');
const 选项 = { now };

function 准备() {
  const 主库 = openMainDb({ file: ':memory:', now: () => now });
  同步.收下(主库, 样例.批次, 选项);
  const 副库 = openUserDb({ file: ':memory:', now: () => now });
  return { 主库, 副库 };
}
const 提醒内容 = (id, edition_id, 改 = {}) => ({
  id, edition_id, competition_name: 'x', task_name: 'x·报名截止提醒', event_type: 'registration_end', event_label: '报名截止',
  target_at: '2026-11-30T15:59:59.999Z', advance_key: '3d', advance_label: '提前 3 天', offset_ms: 259200000, remind_at: '2026-11-27T15:59:59.999Z', ...改,
});

describe('没登录：收藏、提醒用手机带来的编号（和旧版一样）', () => {
  test.each(样例.cases.map(c => [c.名, c.请求, c.结果]))('%s', (_名, 请求, 结果) => {
    const { 主库, 副库 } = 准备();
    expect(呈现首页(请求, { 主库, 副库, 用户id: null, now })).toEqual(结果);
  });
});

describe('登录了：收藏、提醒从副数据库读，不信手机带来的', () => {
  test('收藏的比赛、已授权还没发的提醒参与分档；没授权的提醒不算；手机带来的编号不用', () => {
    const { 主库, 副库 } = 准备();
    const 甲 = 用户.新建或登录(副库, { openid: 'o-1' }, 选项);
    收藏.加(副库, 甲.id, 'c-art', 选项);
    提醒.保存(副库, 甲.id, 提醒内容('r-1', 'e-cs', { authorization_status: 'accepted' }), 选项);
    提醒.保存(副库, 甲.id, 提醒内容('r-2', 'e-done2'), 选项);
    提醒.保存(副库, 甲.id, 提醒内容('r-3', 'e-any', { authorization_status: 'accepted', delivery_status: 'sent' }), 选项);
    const 期望 = 样例.cases.find(c => c.名 === '搜设计带收藏').结果;
    const 请求 = { listVersion: 2, page: 1, pageSize: 16, keyword: '设计', favoriteIds: ['c-any'], reminderIds: ['e-any'] };
    expect(呈现首页(请求, { 主库, 副库, 用户id: 甲.id, now })).toEqual(期望);
  });
});

describe('用户输入：只收认得的条件，超范围的收回到范围里', () => {
  test('关键词去首尾空格、最长 100 字；页码 1–100，每页 1–100（默认 8）；分组只认四种', () => {
    const 条件 = 整理输入({ keyword: `  ${'数'.repeat(120)} `, page: 0, pageSize: 500, listGroups: ['报名中', '已下线', 3] });
    expect(条件.关键词).toHaveLength(100);
    expect([条件.页, 条件.每页]).toEqual([1, 100]);
    expect(条件.列表分组).toEqual(['报名中']);
    expect(整理输入({}).每页).toBe(8);
    expect(整理输入({ page: 2.5 }).页).toBe(1);
  });
  test('专业大类最多 13 个、省份最长 20 字；收藏和提醒编号只认字母数字横线下划线、最多 200 个、去重', () => {
    const 条件 = 整理输入({ categories: Array.from({ length: 20 }, (_, i) => `类${i}`), province: '浙江省'.repeat(10),
      favoriteIds: ['c-1', 'c-1', 'c 2', '../x', ...Array.from({ length: 300 }, (_, i) => `c${i}`)] });
    expect(条件.专业们).toHaveLength(13);
    expect(条件.省份).toHaveLength(20);
    expect(条件.收藏[0]).toBe('c-1');
    expect(条件.收藏).toHaveLength(200);
    expect(条件.收藏).not.toContain('c 2');
  });
  test('面板条件换成中文名；不认识的参数不要；距报名多久只认 1m、3m、6m', () => {
    const 条件 = 整理输入({ eventLevel: '国家级', feeType: '免费', registrationWithin: '2y', openid: 'o-x', sortBy: 'time' });
    expect(条件.面板).toEqual({ 级别: '国家级', 费用: '免费' });
    expect(条件.几天内能报).toBeNull();
    expect(整理输入({ registrationWithin: '3m' }).几天内能报).toBe(92);
    expect(Object.keys(条件)).not.toContain('openid');
  });
});

describe('海报链接：卡片的 poster_url', () => {
  const 图 = 假JPG(640, 360, 2000);
  const 文件 = `${内容哈希(图)}.jpg`;
  function 带海报() {
    const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '呈现海报-'));
    const { 主库, 副库 } = 准备();
    const 届次 = 样例.批次.届次们.find(e => e.id === 'e-art');
    同步.收下(主库, { 届次们: [{ ...届次, version: 2, data: { ...届次.data, poster: { file: 文件 } } }] }, 选项);
    return { 主库, 副库, 目录 };
  }
  const 卡 = (回, id) => 回.items.find(item => item.id === id);
  const 请求 = { listVersion: 2, page: 1, pageSize: 16 };
  test('有海报、北京有这张图、配了海报地址：链接 = 海报地址/文件名；别的卡片是空的', () => {
    const { 主库, 副库, 目录 } = 带海报();
    海报.收(文件, 图, { 目录 });
    const 回 = 呈现首页(请求, { 主库, 副库, now, 海报地址: 'https://example.cn/海报', 海报目录: 目录 });
    expect(卡(回, 'e-art').poster_url).toBe(`https://example.cn/海报/${文件}`);
    expect(卡(回, 'e-math').poster_url).toBe('');
  });
  test('这边还没收到这张图、或者没配海报地址：链接是空的（小程序显示文字封面）', () => {
    const { 主库, 副库, 目录 } = 带海报();
    expect(卡(呈现首页(请求, { 主库, 副库, now, 海报地址: 'https://example.cn/海报', 海报目录: 目录 }), 'e-art').poster_url).toBe('');
    海报.收(文件, 图, { 目录 });
    expect(卡(呈现首页(请求, { 主库, 副库, now, 海报目录: 目录 }), 'e-art').poster_url).toBe('');
  });
});
