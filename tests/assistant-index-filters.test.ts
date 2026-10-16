import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 从赛事助手点“去找比赛页看全部”回到首页：首页换成助手用的那组条件，只用一次
const listCompetitions = vi.fn();
vi.mock('../apps/miniprogram/services/repository', () => ({ getProfessionOptions: () => ['计算机与AI', '设计与艺术'], listCompetitions }));
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
  listCompetitions.mockReset().mockResolvedValue({ items: [], total: 0, hasMore: false });
  app.globalData = {};
  vi.stubGlobal('wx', { getStorageSync: vi.fn(() => undefined), setStorageSync: vi.fn(), showToast: vi.fn(), navigateTo: vi.fn() });
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
    page.setData({ teamSizeCategory: '2～3人', registrationOrganization: '自行报名', sortOrder: 'desc', preferenceProvince: '江苏省' });
    page.applyAssistantFilters();
    expect(page.data).toMatchObject({
      keyword: '智能', appliedKeyword: '智能', competitionCategories: ['计算机与AI'], professionIndex: 1, preferenceProvince: '',
      region: '浙江省', participationFormat: '团队赛', registrationWithin: '1m', feeType: '免费', sortBy: 'time',
      teamSizeCategory: '', registrationOrganization: '', sortOrder: '',
    });
    expect(page.data.levelIndex).toBeGreaterThan(0);
    expect(page.data.statusIndex).toBeGreaterThan(0);
    expect(app.globalData.assistantFilters).toBeNull();
    await vi.waitFor(() => expect(listCompetitions).toHaveBeenCalled());
    expect(listCompetitions.mock.calls[0][0]).toMatchObject({ keyword: '智能', eventLevel: '国家级', registrationStatus: '报名中', participationFormat: '团队赛', registrationWithin: '1m', region: '浙江省' });
  });

  it('没有带条件时什么都不做', () => {
    const page = makePage();
    const before = structuredClone(page.data);
    page.applyAssistantFilters();
    expect(page.data).toEqual(before);
    expect(listCompetitions).not.toHaveBeenCalled();
  });
});
