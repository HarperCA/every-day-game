// 网页测试版（apps/web）：共享代码与小程序一致、匿名统计的校验限流、后台汇总口径。
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PROFESSION_CATEGORIES, statusOptions, levelOptions } from '../apps/miniprogram/services/filterOptions';
import { hydratePublic } from '../apps/miniprogram/services/publicRecord';

const require = createRequire(import.meta.url);
const { sanitizeBatch, createRateLimiter, MAX_BATCH } = require('../apps/miniprogram/cloudfunctions/publicData/webEvents.js');
const { aggregateWebStats } = require('../apps/miniprogram/cloudfunctions/adminData/webStats.js');

describe('网页端与小程序共用的代码', () => {
  it('专业大类常量与小程序首页从种子数据算出来的完全一致', () => {
    const seed = require('../apps/miniprogram/data/competitions.js');
    expect(PROFESSION_CATEGORIES).toEqual(Array.from(new Set(seed.flatMap(item => item.professions))).sort());
  });
  it('筛选项与字段转换可以脱离微信环境使用', () => {
    expect(statusOptions[0]).toBe('全部报名状态');
    expect(levelOptions).toContain('国际级');
    const item = hydratePublic({ id:'a', name:'某大赛', registration_status:'报名中', registration_end:'2026-10-15T00:00:00Z', professions:['计算机与AI'] });
    expect(item.statusClass).toBe('status-open');
    expect(item.registrationEndDate).toBe('2026-10-15');
  });
});

describe('匿名使用统计：接收', () => {
  it('只收认识的事件类型，字段截断，不收额外字段', () => {
    const { items } = sanitizeBatch({ visitor:'abcdef12-3456', device:'mobile', events:[
      { type:'search', data:{ keyword:'x'.repeat(200), resultCount:3, phone:'13800000000' } },
      { type:'hack', data:{} },
    ] }, new Date('2026-09-29T00:00:00Z'));
    expect(items).toHaveLength(1);
    expect(items[0].data).toEqual({ keyword:'x'.repeat(60), resultCount:3 });
    expect(items[0].device).toBe('mobile');
    expect(items[0].at).toBe('2026-09-29T00:00:00.000Z');
  });
  it('编号不合法整批丢弃；一批最多 20 条', () => {
    expect(sanitizeBatch({ visitor:'<script>', events:[{ type:'visit' }] }).items).toEqual([]);
    const many = Array.from({ length:50 }, () => ({ type:'visit' }));
    expect(sanitizeBatch({ visitor:'abcdef12', events:many }).items).toHaveLength(MAX_BATCH);
  });
  it('每个编号每小时有条数上限', () => {
    const limiter = createRateLimiter({ limit:5, windowMs:1000 });
    expect(limiter.allow('v1', 5, 0)).toBe(true);
    expect(limiter.allow('v1', 1, 10)).toBe(false);
    expect(limiter.allow('v1', 1, 2000)).toBe(true);
  });
});

describe('匿名使用统计：后台汇总', () => {
  const at = (day, hour = 2) => `2026-09-${day}T0${hour}:00:00.000Z`;
  const events = [
    { visitor:'a', type:'visit', device:'mobile', at:at(27) },
    { visitor:'a', type:'search', at:at(27), data:{ keyword:'数学建模', resultCount:2 } },
    { visitor:'a', type:'view_detail', at:at(27), data:{ id:'e1', name:'数学建模竞赛' } },
    { visitor:'a', type:'open_official', at:at(27), data:{ id:'e1', name:'数学建模竞赛', target:'registration' } },
    { visitor:'a', type:'visit', device:'mobile', at:at(28) },
    { visitor:'b', type:'visit', device:'desktop', at:at(28) },
    { visitor:'b', type:'search', at:at(28), data:{ keyword:'机器人', resultCount:0 } },
    { visitor:'b', type:'view_detail', at:at(28), data:{ id:'e1', name:'数学建模竞赛' } },
    { visitor:'b', type:'feedback', at:at(28), data:{ id:'e1', name:'数学建模竞赛', text:'报名截止日期不对' } },
  ];
  const stats = aggregateWebStats(events, { now:new Date('2026-09-29T00:00:00Z') });
  it('人数、回访、点进官网的比例', () => {
    expect(stats.totals).toMatchObject({ visitors:2, returningVisitors:1, returningRate:50, officialVisitors:1, officialRate:50, searches:2, zeroResultSearches:1, feedback:1 });
    expect(stats.devices).toEqual({ mobile:2, desktop:1 });
  });
  it('按北京时间分天，列出热门搜索词、赛事和纠错', () => {
    expect(stats.daily.map(day => [day.date, day.visitors, day.newVisitors])).toEqual([['2026-09-27', 1, 1], ['2026-09-28', 2, 1]]);
    expect(stats.topKeywords.find(item => item.keyword === '机器人')).toEqual({ keyword:'机器人', count:1, zeroResults:1 });
    expect(stats.topViewed[0]).toEqual({ id:'e1', name:'数学建模竞赛', views:2, visitors:2 });
    expect(stats.feedback[0].text).toBe('报名截止日期不对');
  });
  it('超出统计窗口的不算', () => {
    expect(aggregateWebStats(events, { now:new Date('2026-12-31T00:00:00Z') }).totals.visitors).toBe(0);
  });
});
