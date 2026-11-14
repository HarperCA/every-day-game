// 公开数据：接替上海云函数 publicData（2026-11-02），去掉云函数的兼容外壳。两个动作，交回格式和上海一样：
//   list  首页列表：交给另一个会话写好的 用户呈现模块（按 2026-11-01 定的推荐规则排序），不搬上海 publicData 的列表代码（用户 11-02 定）
//   get   详情：从主数据库读一届，交回它的全部公开内容，加上算好的报名状态
// 两个动作都记一次加载成功（收集报错的统计表），后台“访问异常”页据此算成功率；记不上不影响返回。
// 不用登录也能看；登录了的，首页按他的收藏、提醒、偏好排（用户编号由入口核验的 openid 查出来，不信小程序传的）。
import { describe, expect, test } from 'vitest';
import { openMainDb, 同步 } from '../../../../主数据库/index.mjs';
import { openUserDb, 用户 } from '../../../../副数据库/index.mjs';
import { 打开报错库 } from '../../../收集报错/报错库.mjs';
import { handle } from '../../index.mjs';

const NOW = new Date('2026-11-02T02:00:00Z');   // 北京时间 11-02 10:00
function 环境(over = {}) {
  const 主库 = openMainDb({ file: ':memory:', now: () => NOW });
  同步.收下(主库, {
    比赛们: [
      { id: 'event-math', version: 1, name: '全国大学生数学建模竞赛', level: '国家级', data: { professions: ['数学与统计'], organizer: '中国工业与应用数学学会' } },
      { id: 'event-art', version: 1, name: '省大学生艺术展演', level: '省级/区域级', data: { professions: ['设计与艺术'] } },
    ],
    届次们: [
      { id: 'ed-math-2026', competition_id: 'event-math', version: 1, registration_start: '2026-10-01', registration_end: '2026-11-20', status: '已发布', data: { edition_name: '2026 年', registration_url: 'https://www.mcm.edu.cn' } },
      { id: 'ed-art-2026', competition_id: 'event-art', version: 1, registration_end: '2026-10-20', status: '已归档', data: { edition_name: '第八届' } },
    ],
  });
  const 用户库 = openUserDb({ file: ':memory:', now: () => NOW });
  return { 主库, 用户库, 报错库: 打开报错库(':memory:'), now: () => NOW, ...over };
}

describe('首页列表（list）', () => {
  test('交给用户呈现模块：交回和上海一样的列表格式；不用登录', async () => {
    const r = await handle({ action: 'list', query: {} }, 环境());
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ total: 2, hasMore: false, listVersion: 2 });
    expect(r.data.items.map(x => x.id).sort()).toEqual(['ed-art-2026', 'ed-math-2026']);
    expect(r.data.items.find(x => x.id === 'ed-math-2026')).toMatchObject({ event_id: 'event-math', name: '全国大学生数学建模竞赛', event_level: '国家级', registration_status: '报名中', data_status: 'published' });
  });
  test('登录了的：按入口给的 openid 查出用户编号交给呈现模块（收藏的比赛排序时会用到）；查不到当没登录', async () => {
    const env = 环境();
    const 账号 = 用户.新建或登录(env.用户库, { openid: 'o-1' }, { now: NOW });
    expect((await handle({ action: 'list', query: {} }, { ...env, openid: 'o-1' })).ok).toBe(true);
    expect((await handle({ action: 'list', query: {} }, { ...env, openid: 'o-陌生' })).ok).toBe(true);
    expect(账号.id).toBeTruthy();
  });
  test('记一次加载成功（北京时间的日期）；记不上不影响返回', async () => {
    const env = 环境();
    await handle({ action: 'list', query: {} }, env);
    await handle({ action: 'get', id: 'ed-math-2026' }, env);
    expect(env.报错库.统计('2026-11-02', '2026-11-02')).toEqual([{ date: '2026-11-02', list: 1, get: 1 }]);
    const 坏的 = { ...环境(), 报错库: { 加一: () => { throw new Error('磁盘满了'); } } };
    expect((await handle({ action: 'list', query: {} }, 坏的)).ok).toBe(true);
  });
});

describe('详情（get）', () => {
  test('交回这一届的全部公开内容，加上算好的报名状态和上海详情页用的几个字段名', async () => {
    const r = await handle({ action: 'get', id: 'ed-math-2026' }, 环境());
    expect(r).toMatchObject({ ok: true, data: {
      id: 'ed-math-2026', event_id: 'event-math', name: '全国大学生数学建模竞赛', edition_name: '2026 年', event_level: '国家级',
      organizer: '中国工业与应用数学学会', registration_url: 'https://www.mcm.edu.cn', registration_start: '2026-10-01', registration_end: '2026-11-20',
      data_status: 'published', registration_status: '报名中',
    } });
    expect((await handle({ action: 'get', id: 'ed-art-2026' }, 环境())).data).toMatchObject({ data_status: 'archived', registration_status: '已截止' });
  });
  // 2026-11-02 拿小程序 services/publicRecord.ts hydratePublic 读的字段逐个核对，这几个原来没交回：
  // 推荐的适合谁、短板、准备、把握（上海公开缓存拆成 recommendation_* 平铺），学校报名时间提示（上海 competitionValue.js schoolTimingAdvice）
  test('推荐的详细内容拆成上海的平铺字段名', async () => {
    const env = 环境();
    同步.收下(env.主库, { 届次们: [{ id: 'ed-math-2026', competition_id: 'event-math', version: 2, registration_start: '2026-10-01', registration_end: '2026-11-20', status: '已发布', data: {
      edition_name: '2026 年', recommendation: { recommendation: '值得参加', reasons: ['国家级'], suitable_for: '数学好的', limitations: ['要组队'], preparation: '先做往年题', confidence: '中' } } }] });
    expect((await handle({ action: 'get', id: 'ed-math-2026' }, env)).data).toMatchObject({
      recommendation: '值得参加', recommendation_reasons: ['国家级'], recommendation_suitable_for: '数学好的',
      recommendation_limitations: ['要组队'], recommendation_preparation: '先做往年题', recommendation_confidence: '中',
    });
    // 没有推荐的：和上海一样给空的，不缺字段
    expect((await handle({ action: 'get', id: 'ed-art-2026' }, env)).data).toMatchObject({
      recommendation_reasons: [], recommendation_suitable_for: '', recommendation_limitations: [], recommendation_preparation: '', recommendation_confidence: '',
    });
  });
  test('学校报名时间提示：照上海 schoolTimingAdvice（金值取自旧代码）', async () => {
    const env = 环境();
    const 届 = (id, 组织) => ({ id, competition_id: 'event-math', version: 1, registration_end: '2026-11-20', status: '已发布', data: { edition_name: id, registration_organization: 组织 } });
    同步.收下(env.主库, { 届次们: [届('ed-self', '自行报名'), 届('ed-school', '学校统一报名'), 届('ed-either', '两种方式均可'), 届('ed-blank', undefined)] });
    const 看 = async id => { const d = (await handle({ action: 'get', id }, env)).data; return [d.school_timing_dependent, d.timing_reliability, d.school_timing_note]; };
    const 去问 = '请尽快向教务处、学院或指导老师确认本校安排，不要等到官方截止日。';
    expect(await 看('ed-self')).toEqual([false, 'official', '']);
    expect(await 看('ed-school')).toEqual([true, 'school_controlled', `由学校统一报名。你校的内部截止日期通常早于官方日期。${去问}`]);
    expect(await 看('ed-either')).toEqual([true, 'unverified', `可自行报名，也可能由学校统一组织，两条路的截止时间不一定相同。${去问}`]);
    expect(await 看('ed-blank')).toEqual([true, 'unverified', `报名组织方式尚未确认，官方日期可能不是你实际要赶的时间。${去问}`]);
  });
  // 2026-11-12 用户定：追不到官方通知的新一届用“高校转发”发布，详情页标“信息来自高校转发，以官方通知为准”并附转发链接。
  // 美国推来 info_source（official 或 school_repost）、info_source_url；交给小程序用 infoSource、infoSourceUrl
  test('高校转发：详情带 infoSource=school_repost 和转发链接；旧数据没有这两个字段的当 official、链接为空', async () => {
    const env = 环境();
    同步.收下(env.主库, { 届次们: [{ id: 'ed-art-2027', competition_id: 'event-art', version: 1, registration_end: '2026-12-20', status: '已发布',
      data: { edition_name: '第九届', info_source: 'school_repost', info_source_url: 'https://jwc.example.edu.cn/notice/9' } }] });
    expect((await handle({ action: 'get', id: 'ed-art-2027' }, env)).data).toMatchObject({ infoSource: 'school_repost', infoSourceUrl: 'https://jwc.example.edu.cn/notice/9' });
    expect((await handle({ action: 'get', id: 'ed-math-2026' }, env)).data).toMatchObject({ infoSource: 'official', infoSourceUrl: '' });
  });
  test('高校转发：转发链接不是 http(s) 的不给；不认识的来源值当 official', async () => {
    const env = 环境();
    const 届 = (id, data) => ({ id, competition_id: 'event-art', version: 1, registration_end: '2026-12-20', status: '已发布', data: { edition_name: id, ...data } });
    同步.收下(env.主库, { 届次们: [
      届('ed-bad-url', { info_source: 'school_repost', info_source_url: 'javascript:alert(1)' }),
      届('ed-odd', { info_source: '别的', info_source_url: 'https://x.example.cn' }),
    ] });
    expect((await handle({ action: 'get', id: 'ed-bad-url' }, env)).data).toMatchObject({ infoSource: 'school_repost', infoSourceUrl: '' });
    expect((await handle({ action: 'get', id: 'ed-odd' }, env)).data).toMatchObject({ infoSource: 'official', infoSourceUrl: '' });
  });
  test('高校转发：首页卡片也带 infoSource、infoSourceUrl（卡片上标小标记）；官方的卡片不加这两个字段（省流量，小程序默认 official）', async () => {
    const env = 环境();
    同步.收下(env.主库, { 届次们: [{ id: 'ed-art-2027', competition_id: 'event-art', version: 1, registration_start: '2026-11-01', registration_end: '2026-12-20', status: '已发布',
      data: { edition_name: '第九届', info_source: 'school_repost', info_source_url: 'https://jwc.example.edu.cn/notice/9' } }] });
    const items = (await handle({ action: 'list', query: {} }, env)).data.items;
    expect(items.find(x => x.id === 'ed-art-2027')).toMatchObject({ infoSource: 'school_repost', infoSourceUrl: 'https://jwc.example.edu.cn/notice/9' });
    const 官方卡 = items.find(x => x.id === 'ed-math-2026');
    expect(官方卡.infoSource).toBeUndefined();
    expect(官方卡.infoSourceUrl).toBeUndefined();
  });
  test('找不到、编号不对：public_record_not_found（和上海一样）；不认识的动作：unsupported_action', async () => {
    expect(await handle({ action: 'get', id: 'ed-没有' }, 环境())).toEqual({ ok: false, message: 'public_record_not_found' });
    expect(await handle({ action: 'get', id: { $ne: '' } }, 环境())).toEqual({ ok: false, message: 'public_record_not_found' });
    expect(await handle({ action: 'drop' }, 环境())).toEqual({ ok: false, message: 'unsupported_action' });
  });
});
