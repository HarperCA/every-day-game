import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 从赛事助手点“去找比赛页看全部”回到首页：首页换成助手用的那组条件，只用一次
const listHomeCompetitions = vi.fn();
vi.mock('../apps/miniprogram/services/repository', () => ({ getProfessionOptions: () => ['计算机与AI', '设计与艺术'], listHomeCompetitions }));
vi.mock('../apps/miniprogram/services/favorites', () => ({ getFavoriteIds: () => [], toggleFavorite: () => false }));

let definition: any;
const app = { globalData: {} as Record<string, any> };
function makePage() {
  return { ...definition, data: structuredClone(definition.data), setData(patch: any, callback?: () => void) { Object.assign(this.data, patch); callback?.(); } };
}
beforeAll(async () => {
  vi.stubGlobal('Page', (options: any) => { definition = options; });
  vi.stubGlobal('getApp', () => app);
  await import('../apps/miniprogram/pages/index/index');
});
beforeEach(() => {
  listHomeCompetitions.mockReset().mockResolvedValue({ items: [], total: 0, hasMore: false, appliedCategories: null });
  app.globalData = {};
  vi.stubGlobal('wx', { getStorageSync: vi.fn(() => undefined), setStorageSync: vi.fn(), showToast: vi.fn(), navigateTo: vi.fn(), pageScrollTo: vi.fn() });
});

describe('首页接收赛事助手的条件', () => {
  it('入口进赛事助手页', () => {
    makePage().openAssistant();
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/assistant/assistant' });
  });

  it('换成助手的条件并重新查询，取走后清掉', async () => {
    app.globalData.assistantFilters = {
      keyword: '智能', competitionCategories: ['计算机与AI'], eventLevel: '国家级', registrationStatus: '报名中',
      participationFormat: '团队赛', registrationWithin: '1m', region: '浙江省', feeType: '免费', sortBy: 'time',
    };
    const page = makePage();
    page.setData({ teamSizeCategory: '2～3人', registrationOrganization: '自行报名', statusTab: 2 });
    page.applyAssistantFilters();
    // 2026-10-24 首页改版：没有排序方式了，助手的排序不带过来；报名状态换成状态标签
    expect(page.data).toMatchObject({
      keyword: '智能', appliedKeyword: '智能', categories: ['计算机与AI'], region: '浙江省', eventLevel: '国家级', statusTab: 0,
      participationFormat: '团队赛', registrationWithin: '1m', feeType: '免费', teamSizeCategory: '', registrationOrganization: '',
    });
    expect(app.globalData.assistantFilters).toBeNull();
    await vi.waitFor(() => expect(listHomeCompetitions).toHaveBeenCalled());
    expect(listHomeCompetitions.mock.calls[0][0]).toMatchObject({ keyword: '智能', eventLevel: '国家级', participationFormat: '团队赛', registrationWithin: '1m', feeType: '免费' });
  });

  it('助手的报名状态换成对应的标签：即将报名、时间待公布 → 未开始，已截止 → 已截止', () => {
    for (const [status, tab] of [['即将报名', 1], ['时间待公布', 1], ['已截止', 2], ['', 0]] as const) {
      app.globalData.assistantFilters = { keyword: '', registrationStatus: status };
      const page = makePage();
      page.applyAssistantFilters();
      expect(page.data.statusTab).toBe(tab);
    }
  });

  it('没有带条件时什么都不做', () => {
    const page = makePage();
    const before = structuredClone(page.data);
    page.applyAssistantFilters();
    expect(page.data).toEqual(before);
    expect(listHomeCompetitions).not.toHaveBeenCalled();
  });
});
