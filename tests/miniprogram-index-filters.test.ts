import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventLevels, feeTypes, participationFormats, registrationOrganizations, teamSizeCategories } from '../apps/admin/src/validation';
import { feeTypeOptions, levelOptions, participationFormatOptions, registrationOrganizationOptions, teamSizeOptions } from '../apps/miniprogram/services/filterOptions';

// 首页筛选（2026-10-24 改版）：状态标签 + 面板（地区、专业大类放进面板，一长列）+ 一次请求走新版列表
const listHomeCompetitions = vi.fn();
let favoriteIds: string[] = [];
let reminderRecords: any[] = [];
vi.mock('../apps/miniprogram/services/repository', () => ({
  getProfessionOptions: () => ['计算机与AI', '设计与艺术'],
  listHomeCompetitions,
}));
vi.mock('../apps/miniprogram/services/favorites', () => ({
  getFavoriteIds: () => favoriteIds,
  toggleFavorite: () => false,
}));
vi.mock('../apps/miniprogram/services/reminders', () => ({
  getReminderRecords: () => reminderRecords,
}));

let definition: any;
function makePage() {
  return {
    ...definition,
    marked: { favoriteIds: [], reminderIds: [] },
    sectionTops: [],
    data: structuredClone(definition.data),
    setData(patch: Record<string, unknown>, callback?: () => void) {
      Object.assign(this.data, patch);
      callback?.();
    },
  };
}
const empty = { items: [], total: 0, hasMore: false, appliedCategories: null };
const lastQuery = () => listHomeCompetitions.mock.calls[listHomeCompetitions.mock.calls.length - 1][0];
const tap = (dataset: Record<string, unknown>) => ({ currentTarget: { dataset } });
// 面板里每一类小标题的位置：地区 0、专业大类 300、级别 700……；右侧可见高度 500
const selectorQuery = {
  in() { return this; }, select() { return this; }, selectAll() { return this; }, boundingClientRect() { return this; },
  exec(callback: (res: any) => void) { callback([{ top: 100, height: 500 }, [0, 300, 700, 900, 1100, 1300, 1500, 1700].map(top => ({ top: top + 100 }))]); },
};

beforeAll(async () => {
  vi.stubGlobal('Page', (options: any) => { definition = options; });
  await import('../apps/miniprogram/pages/index/index');
});
beforeEach(() => {
  listHomeCompetitions.mockReset().mockResolvedValue(empty);
  favoriteIds = [];
  reminderRecords = [];
  vi.stubGlobal('wx', { getStorageSync: vi.fn(() => undefined), setStorageSync: vi.fn(), showToast: vi.fn(), createSelectorQuery: () => selectorQuery });
});
afterEach(() => { vi.useRealTimers(); });

describe('首页偏好调查', () => {
  it('confirms one survey page at a time, preserves choices on back, and saves only at the final step', () => {
    const page = makePage();
    page.openPreferenceSurvey();
    page.onSurveyProvinceChange({detail:{value:[page.data.surveyProvinceOptions.indexOf('浙江省')]}});
    page.confirmPreferenceSurveyStep();
    expect(page.data.surveyStep).toBe(1);
    expect(wx.setStorageSync).not.toHaveBeenCalled();
    page.selectSurveyCategory(tap({value:'计算机与AI'}));
    page.previousPreferenceSurveyStep();
    expect(page.data.surveyStep).toBe(0);
    expect(page.data.surveyProvinceOptions[page.data.surveyProvinceIndex]).toBe('浙江省');
    expect(page.data.surveyCategories).toEqual(['计算机与AI']);
    page.confirmPreferenceSurveyStep();
    expect(page.data.surveyStep).toBe(1);
    expect(wx.setStorageSync).not.toHaveBeenCalled();
    page.onSurveyProvinceChange({detail:{value:[page.data.surveyProvinceOptions.indexOf('浙江省')]}});
    page.confirmPreferenceSurveyStep();
    // 偏好只在最后一步存一次（另有一次记“已填完”的状态，供登录后存进账号）
    expect(vi.mocked(wx.setStorageSync).mock.calls.filter(call => call[0] === 'competition-preferences-v1')).toHaveLength(1);
    expect(page.data.surveyVisible).toBe(false);
    expect(page.data.region).toBe('浙江省');
  });

  it('填完调查：偏好成为当前的地区和专业大类，并按它重新查询', () => {
    const page = makePage();
    page.data.surveyVisible = true;
    page.selectSurveyCategory(tap({value:'计算机与AI'}));
    page.selectSurveyCategory(tap({value:'设计与艺术'}));
    page.onSurveyProvinceChange({detail:{value:[page.data.surveyProvinceOptions.indexOf('浙江省')]}});
    page.data.surveyDontShowAgain = true;
    page.completePreferenceSurvey();
    expect(wx.setStorageSync).toHaveBeenCalledWith('competition-preferences-v1', {
      profession:'',categories:['计算机与AI','设计与艺术'],province:'浙江省',dontShowAgain:true,
    });
    expect(page.data.surveyVisible).toBe(false);
    expect(lastQuery()).toMatchObject({categories:['计算机与AI','设计与艺术'],province:'浙江省',listGroups:['报名中']});
    expect(page.data.filterCount).toBe(2);
  });

  it('survey completion saves the wheel focus even without tapping the profession row',()=>{
    const page=makePage();
    page.openPreferenceSurvey();
    page.confirmPreferenceSurveyStep();
    page.onSurveyCategoryChange({detail:{value:[1]}});
    page.confirmPreferenceSurveyStep();
    expect(wx.setStorageSync).toHaveBeenCalledWith('competition-preferences-v1',expect.objectContaining({categories:['计算机与AI']}));
    expect(page.data.categories).toEqual(['计算机与AI']);
  });
  it('survey does not restore a center option explicitly deselected after scrolling',()=>{
    const page=makePage();
    page.openPreferenceSurvey();
    page.confirmPreferenceSurveyStep();
    page.selectSurveyCategory(tap({value:'计算机与AI'}));
    page.selectSurveyCategory(tap({value:'设计与艺术'}));
    page.onSurveyCategoryChange({detail:{value:[1]}});
    page.selectSurveyCategory(tap({value:'计算机与AI'}));
    page.confirmPreferenceSurveyStep();
    expect(page.data.categories).toEqual(['设计与艺术']);
  });
  it('survey scrolling to unlimited clears every selected profession on completion',()=>{
    const page=makePage();
    page.openPreferenceSurvey();
    page.confirmPreferenceSurveyStep();
    page.selectSurveyCategory(tap({value:'计算机与AI'}));
    page.selectSurveyCategory(tap({value:'设计与艺术'}));
    page.onSurveyCategoryChange({detail:{value:[0]}});
    page.confirmPreferenceSurveyStep();
    expect(wx.setStorageSync).toHaveBeenCalledWith('competition-preferences-v1',expect.objectContaining({categories:[]}));
    expect(page.data.categories).toEqual([]);
  });

  it('skip preserves saved choices, saves opt-out and never applies unfinished answers', () => {
    vi.mocked(wx.getStorageSync).mockReturnValue({profession:'数学与统计',categories:['数学与统计'],province:'江苏省',dontShowAgain:false});
    const page = makePage();
    page.data.surveyVisible = true;
    page.data.surveyCategories = ['计算机与AI'];
    page.data.surveyProvinceIndex = page.data.surveyProvinceOptions.indexOf('浙江省');
    page.data.surveyDontShowAgain = true;
    page.skipPreferenceSurvey();
    expect(wx.setStorageSync).toHaveBeenCalledWith('competition-preferences-v1', {profession:'',categories:['数学与统计'],province:'江苏省',dontShowAgain:true});
    expect(page.data.surveyVisible).toBe(false);
    expect(listHomeCompetitions).not.toHaveBeenCalled();
  });

  it('allows skipping even when local storage fails', () => {
    vi.mocked(wx.setStorageSync).mockImplementation(() => { throw new Error('storage unavailable'); });
    const page = makePage();
    page.data.surveyVisible = true;
    page.skipPreferenceSurvey();
    expect(page.data.surveyVisible).toBe(false);
    expect(wx.showToast).toHaveBeenCalledWith({title:'未能记住弹窗设置',icon:'none'});
  });
});

describe('首页状态标签', () => {
  it('offers exactly the values accepted by the admin record fields', () => {
    expect(levelOptions.slice(1)).toEqual(eventLevels);
    expect(participationFormatOptions).toEqual(participationFormats);
    expect(teamSizeOptions).toEqual(teamSizeCategories);
    expect(feeTypeOptions).toEqual(feeTypes);
    expect(registrationOrganizationOptions).toEqual(registrationOrganizations);
  });

  it('默认报名中；未开始含时间待公布（即将报名），已截止含比赛中和比赛已结束', async () => {
    vi.useFakeTimers();
    const page = makePage();
    expect(page.data.statusTabs).toEqual(['报名中', '未开始', '已截止']);
    await page.load(true, true);
    expect(lastQuery().listGroups).toEqual(['报名中']);
    page.onStatusTab(tap({index:1}));
    await vi.advanceTimersByTimeAsync(300);
    expect(lastQuery().listGroups).toEqual(['时间待公布']);
    page.onStatusTab(tap({index:2}));
    await vi.advanceTimersByTimeAsync(300);
    expect(lastQuery().listGroups).toEqual(['比赛中', '比赛已结束']);
  });

  it('连续快速点标签：停手 0.3 秒后只发最后一个；再点已选中的标签不取消、不重查', async () => {
    vi.useFakeTimers();
    const page = makePage();
    page.onStatusTab(tap({index:1}));
    page.onStatusTab(tap({index:2}));
    await vi.advanceTimersByTimeAsync(299);
    expect(listHomeCompetitions).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(listHomeCompetitions).toHaveBeenCalledTimes(1);
    expect(lastQuery().listGroups).toEqual(['比赛中', '比赛已结束']);
    page.onStatusTab(tap({index:2}));
    await vi.advanceTimersByTimeAsync(300);
    expect(listHomeCompetitions).toHaveBeenCalledTimes(1);
    expect(page.data.statusTab).toBe(2);
  });
});

describe('首页搜索', () => {
  it('搜索词去掉首尾空格；服务器映射出的专业大类记下来，翻页沿用搜索词', async () => {
    listHomeCompetitions.mockResolvedValue({ ...empty, hasMore: true, appliedCategories: ['数学与统计'] });
    const page = makePage();
    page.onKeywordInput({detail:{value:'  数学建模  '}});
    page.onSearch();
    expect(lastQuery()).toMatchObject({ keyword:'数学建模', page:1 });
    await vi.waitFor(() => expect(page.data.searchCategories).toEqual(['数学与统计']));
    page.onKeywordInput({detail:{value:'还没点搜索的新词'}});
    await page.load(false);
    expect(lastQuery()).toMatchObject({ keyword:'数学建模', page:2 });
  });

  it('搜索时点状态标签算改筛选：清空搜索框，按这个标签和原来的条件查', async () => {
    vi.useFakeTimers();
    const page = makePage();
    Object.assign(page.data, { region:'浙江省', categories:['计算机与AI'], keyword:'挑战杯', appliedKeyword:'挑战杯', searchCategories:['计算机与AI'] });
    page.onStatusTab(tap({index:0}));
    expect(page.data).toMatchObject({ keyword:'', appliedKeyword:'', searchCategories:[], statusTab:0 });
    await vi.advanceTimersByTimeAsync(300);
    expect(lastQuery()).toMatchObject({ keyword:'', province:'浙江省', categories:['计算机与AI'], listGroups:['报名中'] });
  });

  it('搜索时打开面板显示搜索实际用的条件；点确定就清空搜索，按面板条件查', () => {
    const page = makePage();
    Object.assign(page.data, { region:'浙江省', categories:['设计与艺术'], feeType:'免费', keyword:'数学建模', appliedKeyword:'数学建模', searchCategories:['数学与统计'] });
    page.openMoreFilters();
    expect(page.data).toMatchObject({ draftRegion:'', draftCategories:['数学与统计'], draftFeeType:'免费' });
    page.applyMoreFilters();
    expect(page.data).toMatchObject({ keyword:'', appliedKeyword:'', region:'', categories:['数学与统计'], feeType:'免费' });
    expect(lastQuery()).toMatchObject({ keyword:'', categories:['数学与统计'], feeType:'免费' });
  });
});

describe('首页筛选面板', () => {
  it('地区单选，点“不限”或再点一次取消；专业大类多选，点“不限”清空', () => {
    const page = makePage();
    page.openMoreFilters();
    // 省份从滚轮里选：滚轮里没有“全国”
    expect(page.data.provinceOptions).not.toContain('全国');
    page.onProvincePick({ detail:{ value: page.data.provinceOptions.indexOf('江苏省') } });
    expect(page.data).toMatchObject({ draftRegion:'江苏省', provincePickerIndex: page.data.provinceOptions.indexOf('江苏省') });
    page.closeMoreFilters();
    page.data.region = '江苏省';
    page.openMoreFilters();
    expect(page.data.provincePickerIndex).toBe(page.data.provinceOptions.indexOf('江苏省'));
    page.selectMoreOption(tap({kind:'region', value:'浙江省'}));
    expect(page.data.draftRegion).toBe('浙江省');
    page.selectMoreOption(tap({kind:'region', value:'不限'}));
    expect(page.data.draftRegion).toBe('');
    page.selectMoreOption(tap({kind:'region', value:'全国'}));
    page.selectMoreOption(tap({kind:'region', value:'全国'}));
    expect(page.data.draftRegion).toBe('');
    page.selectMoreOption(tap({kind:'categories', value:'计算机与AI'}));
    page.selectMoreOption(tap({kind:'categories', value:'设计与艺术'}));
    expect(page.data.draftCategories).toEqual(['计算机与AI', '设计与艺术']);
    page.selectMoreOption(tap({kind:'categories', value:'计算机与AI'}));
    expect(page.data.draftCategories).toEqual(['设计与艺术']);
    expect(page.data.categoryChips.filter((chip: any) => chip.selected).map((chip: any) => chip.label)).toEqual(['设计与艺术']);
    page.selectMoreOption(tap({kind:'categories', value:'不限'}));
    expect(page.data.draftCategories).toEqual([]);
    expect(page.data.categoryChips.filter((chip: any) => chip.selected).map((chip: any) => chip.label)).toEqual(['不限']);
  });

  it('面板里改的条件点确定才生效；左边小圆点、筛选按钮上的个数跟着变', () => {
    const page = makePage();
    page.openMoreFilters();
    page.selectMoreOption(tap({kind:'region', value:'浙江省'}));
    page.selectMoreOption(tap({kind:'eventLevel', value:'国家级'}));
    expect(page.data.sectionMarks).toEqual([true, false, true, false, false, false, false, false]);
    expect(page.data.region).toBe('');
    page.closeMoreFilters();
    page.openMoreFilters();
    expect(page.data.draftRegion).toBe('');
    page.selectMoreOption(tap({kind:'region', value:'浙江省'}));
    page.selectMoreOption(tap({kind:'categories', value:'计算机与AI'}));
    page.selectMoreOption(tap({kind:'eventLevel', value:'国家级'}));
    page.applyMoreFilters();
    expect(page.data).toMatchObject({ region:'浙江省', categories:['计算机与AI'], eventLevel:'国家级', filterCount:3, morePanelVisible:false });
    expect(lastQuery()).toMatchObject({ province:'浙江省', categories:['计算机与AI'], eventLevel:'国家级', listGroups:['报名中'] });
  });

  it('清空选择连地区和专业大类一起清', () => {
    const page = makePage();
    Object.assign(page.data, { region:'浙江省', categories:['计算机与AI'], feeType:'免费', registrationWithin:'1m' });
    page.openMoreFilters();
    page.resetMoreFilters();
    expect(page.data).toMatchObject({ draftRegion:'', draftCategories:[], draftFeeType:'', draftRegistrationWithin:'' });
    expect(page.data.region).toBe('浙江省');
    page.applyMoreFilters();
    expect(page.data).toMatchObject({ region:'', categories:[], feeType:'', registrationWithin:'', filterCount:0 });
  });

  it('面板底部的场数按点确定以后的条件算：面板里的条件 + 当前标签，不带搜索词', async () => {
    const page = makePage();
    Object.assign(page.data, { statusTab:1, appliedKeyword:'挑战杯', morePanelVisible:true, draftRegion:'浙江省', draftFeeType:'免费' });
    listHomeCompetitions.mockResolvedValue({ ...empty, total:12 });
    await page.refreshMorePreview();
    expect(lastQuery()).toMatchObject({ province:'浙江省', feeType:'免费', listGroups:['时间待公布'], pageSize:1 });
    expect(lastQuery().keyword).toBeUndefined();
    expect(page.data.morePreviewCount).toBe(12);
  });

  it('点左边某一类：右边滚到那一类；往下滑时左边高亮跟着走，滑到底高亮最后一类', () => {
    const page = makePage();
    page.openMoreFilters();
    expect(page.sectionTops).toEqual([0, 300, 700, 900, 1100, 1300, 1500, 1700]);
    page.selectFilterSection(tap({index:3}));
    expect(page.data).toMatchObject({ activeSection:3, sectionScrollInto:'fsec-3' });
    // 点完后的自动滚动期间不跟着改高亮
    page.onFilterScroll({ detail:{ scrollTop:0, scrollHeight:2400 } });
    expect(page.data.activeSection).toBe(3);
    page.spyLockedUntil = 0;
    page.onFilterScroll({ detail:{ scrollTop:320, scrollHeight:2400 } });
    expect(page.data.activeSection).toBe(1);
    page.onFilterScroll({ detail:{ scrollTop:1000, scrollHeight:2400 } });
    expect(page.data.activeSection).toBe(3);
    page.onFilterScroll({ detail:{ scrollTop:1900, scrollHeight:2400 } });
    expect(page.data.activeSection).toBe(7);
  });
});

describe('首页收藏、提醒快照和请求顺序', () => {
  it('筛选、搜索时拍收藏和提醒快照；翻页沿用同一份，点收藏不马上重排', async () => {
    favoriteIds = ['fav-1'];
    reminderRecords = [
      { editionId:'rem-1', authorizationStatus:'accepted', deliveryStatus:'pending' },
      { editionId:'rem-2', authorizationStatus:'accepted', deliveryStatus:'queued' },
      { editionId:'rem-sent', authorizationStatus:'accepted', deliveryStatus:'sent' },
      { editionId:'rem-expired', authorizationStatus:'accepted', deliveryStatus:'expired' },
      { editionId:'rem-rejected', authorizationStatus:'rejected', deliveryStatus:'pending' },
    ];
    const page = makePage();
    await page.load(true, true);
    expect(lastQuery()).toMatchObject({ favoriteIds:['fav-1'], reminderIds:['rem-1', 'rem-2'] });
    favoriteIds = ['fav-1', 'fav-2'];
    await page.load(false);
    expect(lastQuery().favoriteIds).toEqual(['fav-1']);
    page.onSearch();
    expect(lastQuery().favoriteIds).toEqual(['fav-1', 'fav-2']);
  });

  it('keeps the newest list result when an older filter request returns later', async () => {
    const pending: Array<(value: unknown) => void> = [];
    listHomeCompetitions.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const page = makePage();
    const oldLoad = page.load(true);
    page.data.statusTab = 1;
    const newLoad = page.load(true);
    expect(listHomeCompetitions.mock.calls[1][0].listGroups).toEqual(['时间待公布']);
    pending[1]({ ...empty, items: [{ id: 'new' }], total: 1 });
    await newLoad;
    pending[0]({ ...empty, items: [{ id: 'old' }], total: 1 });
    await oldLoad;
    expect(page.data.items.map((item: any) => item.id)).toEqual(['new']);
  });

  it('keeps the newest preview count when an older filter request returns later', async () => {
    const pending: Array<(value: unknown) => void> = [];
    listHomeCompetitions.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const page = makePage();
    page.data.morePanelVisible = true;
    const oldPreview = page.refreshMorePreview();
    page.data.draftFeeType = '免费';
    const newPreview = page.refreshMorePreview();
    expect(listHomeCompetitions.mock.calls[1][0].feeType).toBe('免费');
    pending[1]({ ...empty, total: 8 });
    await newPreview;
    pending[0]({ ...empty, total: 30 });
    await oldPreview;
    expect(page.data.morePreviewCount).toBe(8);
  });
});
