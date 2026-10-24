import { beforeEach, expect, it, vi } from 'vitest';

// 首页一次请求走新版列表（2026-10-24）：发出去的内容和收回来的处理
const { callPublicData } = vi.hoisted(() => ({ callPublicData: vi.fn() }));
vi.mock('../apps/miniprogram/services/cloudSession', () => ({ callPublicData }));
import { listHomeCompetitions } from '../apps/miniprogram/services/repository';

beforeEach(() => { callPublicData.mockReset().mockResolvedValue({ items: [], total: 0, hasMore: false }); });
const sent = () => callPublicData.mock.calls[0][1].query;

it('只发一次 list，带 listVersion 2；没选的条件不带', async () => {
  await listHomeCompetitions({ categories:['计算机与AI'], province:'浙江省', listGroups:['报名中'], feeType:'免费', eventLevel:'', favoriteIds:['a'], reminderIds:[], page:2, pageSize:16 });
  expect(callPublicData).toHaveBeenCalledTimes(1);
  expect(callPublicData.mock.calls[0][0]).toBe('list');
  expect(sent()).toEqual({ listVersion:2, page:2, pageSize:16, feeType:'免费', categories:['计算机与AI'], province:'浙江省', listGroups:['报名中'], favoriteIds:['a'] });
});

it('有搜索词时不带专业大类、省份和状态分组；返回映射出的专业大类', async () => {
  callPublicData.mockResolvedValue({ items: [], total: 0, hasMore: false, appliedFilters:{ categories:['数学与统计'] } });
  const result = await listHomeCompetitions({ keyword:' 数学建模 ', categories:['计算机与AI'], province:'浙江省', listGroups:['报名中'], feeType:'免费' });
  expect(sent()).toEqual({ listVersion:2, page:1, pageSize:16, keyword:'数学建模', feeType:'免费' });
  expect(result.appliedCategories).toEqual(['数学与统计']);
});

it('不是搜索时 appliedCategories 为空；卡片带上状态分组', async () => {
  callPublicData.mockResolvedValue({ items: [{ id:'x', name:'比赛', list_group:'比赛中', registration_status:'已截止' }], total: 1, hasMore: false });
  const result = await listHomeCompetitions({ listGroups:['比赛中', '比赛已结束'] });
  expect(result.appliedCategories).toBeNull();
  expect(result.items[0]).toMatchObject({ id:'x', listGroup:'比赛中', registrationStatus:'已截止' });
  expect(result.total).toBe(1);
});
