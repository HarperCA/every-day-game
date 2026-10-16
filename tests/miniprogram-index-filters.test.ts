import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventLevels, feeTypes, participationFormats, registrationOrganizations, teamSizeCategories } from '../apps/admin/src/validation';
import { feeTypeOptions, levelOptions, participationFormatOptions, registrationOrganizationOptions, teamSizeOptions } from '../apps/miniprogram/services/filterOptions';

const listCompetitions = vi.fn();
vi.mock('../apps/miniprogram/services/repository', () => ({
  getProfessionOptions: () => ['计算机与AI', '设计与艺术'],
  listCompetitions,
}));
vi.mock('../apps/miniprogram/services/favorites', () => ({
  getFavoriteIds: () => [],
  toggleFavorite: () => false,
}));

let definition: any;
function makePage() {
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch: Record<string, unknown>, callback?: () => void) {
      Object.assign(this.data, patch);
      callback?.();
    },
  };
}

beforeAll(async () => {
  vi.stubGlobal('Page', (options: any) => { definition = options; });
  await import('../apps/miniprogram/pages/index/index');
});
beforeEach(() => {
  listCompetitions.mockReset();
  vi.stubGlobal('wx', {getStorageSync:vi.fn(() => undefined), setStorageSync:vi.fn(), showToast:vi.fn()});
});

describe('home competition filters', () => {
  it('confirms one survey page at a time, preserves choices on back, and saves only at the final step', () => {
    listCompetitions.mockResolvedValue({items:[],total:0,hasMore:false});
    const page = makePage();
    page.openPreferenceSurvey();
    page.onSurveyProvinceChange({detail:{value:[page.data.surveyProvinceOptions.indexOf('浙江省')]}});
    page.confirmPreferenceSurveyStep();
    expect(page.data.surveyStep).toBe(1);
    expect(wx.setStorageSync).not.toHaveBeenCalled();
    page.selectSurveyCategory({currentTarget:{dataset:{value:'计算机与AI'}}});
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
    expect(page.data.preferenceProvince).toBe('浙江省');
  });

  it('completing the two-step survey saves opt-out and applies region and multiple directions without a second profession constraint', () => {
    listCompetitions.mockResolvedValue({items:[],total:0,hasMore:false});
    const page = makePage();
    page.data.surveyVisible = true;
    page.selectSurveyCategory({currentTarget:{dataset:{value:'计算机与AI'}}});
    page.selectSurveyCategory({currentTarget:{dataset:{value:'设计与艺术'}}});
    page.onSurveyProvinceChange({detail:{value:[page.data.surveyProvinceOptions.indexOf('浙江省')]}});
    page.data.surveyDontShowAgain = true;
    page.completePreferenceSurvey();
    expect(wx.setStorageSync).toHaveBeenCalledWith('competition-preferences-v1', {
      profession:'',categories:['计算机与AI','设计与艺术'],province:'浙江省',dontShowAgain:true,
    });
    expect(page.data.surveyVisible).toBe(false);
    expect(listCompetitions).toHaveBeenCalledWith(expect.objectContaining({profession:'',competitionCategories:['计算机与AI','设计与艺术'],region:'浙江省',preferenceProvince:''}));
  });

  it('survey completion saves the wheel focus even without tapping the profession row',()=>{
    listCompetitions.mockResolvedValue({items:[],total:0,hasMore:false});
    const page=makePage();
    page.openPreferenceSurvey();
    page.confirmPreferenceSurveyStep();
    page.onSurveyCategoryChange({detail:{value:[1]}});
    page.confirmPreferenceSurveyStep();
    expect(wx.setStorageSync).toHaveBeenCalledWith('competition-preferences-v1',expect.objectContaining({categories:['计算机与AI']}));
    expect(page.data.competitionCategories).toEqual(['计算机与AI']);
  });
  it('survey does not restore a center option explicitly deselected after scrolling',()=>{
    listCompetitions.mockResolvedValue({items:[],total:0,hasMore:false});
    const page=makePage();
    page.openPreferenceSurvey();
    page.confirmPreferenceSurveyStep();
    page.selectSurveyCategory({currentTarget:{dataset:{value:'计算机与AI'}}});
    page.selectSurveyCategory({currentTarget:{dataset:{value:'设计与艺术'}}});
    page.onSurveyCategoryChange({detail:{value:[1]}});
    page.selectSurveyCategory({currentTarget:{dataset:{value:'计算机与AI'}}});
    page.confirmPreferenceSurveyStep();
    expect(page.data.competitionCategories).toEqual(['设计与艺术']);
  });
  it('survey scrolling to unlimited clears every selected profession on completion',()=>{
    listCompetitions.mockResolvedValue({items:[],total:0,hasMore:false});
    const page=makePage();
    page.openPreferenceSurvey();
    page.confirmPreferenceSurveyStep();
    page.selectSurveyCategory({currentTarget:{dataset:{value:'计算机与AI'}}});
    page.selectSurveyCategory({currentTarget:{dataset:{value:'设计与艺术'}}});
    page.onSurveyCategoryChange({detail:{value:[0]}});
    page.confirmPreferenceSurveyStep();
    expect(wx.setStorageSync).toHaveBeenCalledWith('competition-preferences-v1',expect.objectContaining({categories:[]}));
    expect(page.data.competitionCategories).toEqual([]);
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
    expect(listCompetitions).not.toHaveBeenCalled();
  });

  it('allows skipping even when local storage fails', () => {
    vi.mocked(wx.setStorageSync).mockImplementation(() => { throw new Error('storage unavailable'); });
    const page = makePage();
    page.data.surveyVisible = true;
    page.skipPreferenceSurvey();
    expect(page.data.surveyVisible).toBe(false);
    expect(wx.showToast).toHaveBeenCalledWith({title:'未能记住弹窗设置',icon:'none'});
  });

  it('offers exactly the values accepted by the admin record fields', () => {
    expect(levelOptions.slice(1)).toEqual(eventLevels);
    expect(participationFormatOptions).toEqual(participationFormats);
    expect(teamSizeOptions).toEqual(teamSizeCategories);
    expect(feeTypeOptions).toEqual(feeTypes);
    expect(registrationOrganizationOptions).toEqual(registrationOrganizations);
  });

  it('selecting a time direction also activates time sorting, and recommended sorting clears the direction', () => {
    listCompetitions.mockResolvedValue({ items: [], total: 0, hasMore: false });
    const page = makePage();
    page.selectMoreOption({ currentTarget: { dataset: { kind: 'sortOrder', value: 'desc' } } });
    expect(page.data.draftSortBy).toBe('time');
    expect(page.data.draftSortOrder).toBe('desc');
    page.selectMoreOption({ currentTarget: { dataset: { kind: 'sortBy', value: '' } } });
    expect(page.data.draftSortBy).toBe('');
    expect(page.data.draftSortOrder).toBe('');
  });

  it('passes the selected region to both the preview and competition list', async () => {
    listCompetitions.mockResolvedValue({ items: [], total: 0, hasMore: false });
    const page = makePage();
    page.data.draftRegion = '浙江省';
    await page.refreshMorePreview();
    expect(listCompetitions.mock.calls[0][0].region).toBe('浙江省');
    page.data.region = '浙江省';
    page.updateSelectedConditions();
    await page.load(true);
    expect(listCompetitions.mock.calls[1][0].region).toBe('浙江省');
    expect(page.data.selectedConditions).toContainEqual({ kind: 'region', label: '赛事地区：浙江省' });
  });

  it('region applies immediately while level changes stay in the panel until confirmed', async () => {
    listCompetitions.mockResolvedValue({ items: [], total: 0, hasMore: false });
    const page = makePage();
    page.data.regionOptions = ['不限', '浙江省'];
    page.data.preferenceProvince = '江苏省';
    page.onRegionChange({detail:{value:1}});
    expect(page.data.regionIndex).toBe(1);
    expect(page.data.preferenceProvince).toBe('');
    expect(page.data.moreFilterCount).toBe(0);
    expect(listCompetitions).toHaveBeenLastCalledWith(expect.objectContaining({region:'浙江省'}));
    page.openMoreFilters();
    page.selectMoreOption({currentTarget:{dataset:{kind:'eventLevel',value:'国家级'}}});
    expect(page.data.levelIndex).toBe(0);
    expect(listCompetitions).toHaveBeenLastCalledWith(expect.objectContaining({eventLevel:'国家级',region:'浙江省'}));
    page.closeMoreFilters();
    page.openMoreFilters();
    expect(page.data.draftEventLevel).toBe('');
    page.selectMoreOption({currentTarget:{dataset:{kind:'eventLevel',value:'国家级'}}});
    page.applyMoreFilters();
    expect(page.data.levelIndex).toBe(levelOptions.indexOf('国家级'));
    expect(page.data.moreFilterCount).toBe(1);
    expect(listCompetitions).toHaveBeenLastCalledWith(expect.objectContaining({eventLevel:'国家级',region:'浙江省'}));
    page.openMoreFilters();
    page.resetMoreFilters();
    page.applyMoreFilters();
    expect(page.data.levelIndex).toBe(0);
    expect(page.data.region).toBe('浙江省');
    page.clearFilters();
    expect(page.data.regionIndex).toBe(1);
    expect(page.data.region).toBe('浙江省');
  });

  it('uses the submitted search word for filters, preview and pagination until search is confirmed again', async () => {
    listCompetitions.mockResolvedValue({ items: [], total: 0, hasMore: false });
    const page = makePage();
    page.onKeywordInput({detail:{value:'  挑战杯  '}});
    page.onSearch();
    expect(listCompetitions).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'挑战杯'}));
    page.onKeywordInput({detail:{value:'数学建模'}});
    page.onStatusChange({detail:{value:1}});
    expect(listCompetitions).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'挑战杯',registrationStatus:'报名中'}));
    page.openMoreFilters();
    expect(listCompetitions).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'挑战杯'}));
    await page.load(false);
    expect(listCompetitions).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'挑战杯',page:2}));
    page.onSearch();
    expect(listCompetitions).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'数学建模',page:1}));
    page.clearFilters();
    expect(page.data.appliedKeyword).toBe('数学建模');
    expect(page.data.keyword).toBe('数学建模');
    expect(page.data.statusIndex).toBe(1);
  });

  it('全部 resets only first-level filters and preserves search and every applied secondary filter', () => {
    listCompetitions.mockResolvedValue({items:[],total:0,hasMore:false});
    const page=makePage();
    Object.assign(page.data,{keyword:'数学建模',appliedKeyword:'数学建模',region:'浙江省',preferenceProvince:'浙江省',professionIndex:1,competitionCategories:['计算机与AI'],statusIndex:1,levelIndex:1,feeType:'免费',participationFormat:'个人赛',teamSizeCategory:'1人',registrationOrganization:'自主报名',registrationWithin:'month',sortBy:'time',sortOrder:'asc'});
    page.updateSelectedConditions();
    page.onComprehensiveTap();
    expect(page.data).toMatchObject({region:'',preferenceProvince:'',professionIndex:0,competitionCategories:[],statusIndex:0,keyword:'数学建模',appliedKeyword:'数学建模',levelIndex:1,feeType:'免费',participationFormat:'个人赛',teamSizeCategory:'1人',registrationOrganization:'自主报名',registrationWithin:'month',sortBy:'time',sortOrder:'asc'});
    expect(listCompetitions).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'数学建模',region:'',registrationStatus:'',competitionCategories:[],feeType:'免费',searchUnion:true}));
  });

  it('clear secondary filters preserves first-level selections, preferences and submitted search', () => {
    listCompetitions.mockResolvedValue({items:[],total:0,hasMore:false});
    const page=makePage();
    Object.assign(page.data,{keyword:'还未搜索的新词',appliedKeyword:'挑战杯',region:'浙江省',preferenceProvince:'浙江省',professionIndex:1,competitionCategories:['计算机与AI'],statusIndex:1,levelIndex:1,feeType:'免费',participationFormat:'个人赛',teamSizeCategory:'1人',registrationOrganization:'自主报名',registrationWithin:'month',sortBy:'time',sortOrder:'desc',draftFeeType:'收费',draftEventLevel:'国家级'});
    page.clearFilters();
    expect(page.data).toMatchObject({keyword:'还未搜索的新词',appliedKeyword:'挑战杯',region:'浙江省',preferenceProvince:'浙江省',professionIndex:1,competitionCategories:['计算机与AI'],statusIndex:1,levelIndex:0,feeType:'',participationFormat:'',teamSizeCategory:'',registrationOrganization:'',registrationWithin:'',sortBy:'',sortOrder:'',draftFeeType:'',draftEventLevel:''});
    expect(page.data.selectedConditions).toContainEqual({kind:'region',label:'赛事地区：浙江省'});
    expect(page.data.moreFilterCount).toBe(0);
    expect(listCompetitions).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'挑战杯',region:'浙江省',competitionCategories:['计算机与AI'],registrationStatus:'报名中',feeType:'',searchUnion:true}));
  });

  it('panel clear resets only temporary secondary options until apply and passes union mode to preview and list', async () => {
    listCompetitions.mockResolvedValue({items:[],total:0,hasMore:false});
    const page=makePage();
    Object.assign(page.data,{appliedKeyword:'挑战杯',region:'浙江省',competitionCategories:['计算机与AI'],statusIndex:1,feeType:'免费',levelIndex:1});
    page.openMoreFilters();
    page.resetMoreFilters();
    expect(page.data.feeType).toBe('免费');
    expect(page.data.levelIndex).toBe(1);
    expect(page.data.draftFeeType).toBe('');
    expect(page.data.draftEventLevel).toBe('');
    expect(page.data.region).toBe('浙江省');
    expect(listCompetitions).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'挑战杯',region:'浙江省',competitionCategories:['计算机与AI'],registrationStatus:'报名中',feeType:'',searchUnion:true}));
    page.applyMoreFilters();
    expect(page.data.feeType).toBe('');
    expect(page.data.levelIndex).toBe(0);
    await page.load(false);
    expect(listCompetitions).toHaveBeenLastCalledWith(expect.objectContaining({keyword:'挑战杯',region:'浙江省',searchUnion:true,page:2}));
  });

  it('keeps the newest list result when an older filter request returns later', async () => {
    const pending: Array<(value: unknown) => void> = [];
    listCompetitions.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const page = makePage();
    const oldLoad = page.load(true);
    page.data.statusIndex = 1;
    const newLoad = page.load(true);
    expect(listCompetitions.mock.calls[1][0].registrationStatus).toBe('报名中');
    pending[1]({ items: [{ id: 'new' }], total: 1, hasMore: false });
    await newLoad;
    pending[0]({ items: [{ id: 'old' }], total: 1, hasMore: false });
    await oldLoad;
    expect(page.data.items.map((item: any) => item.id)).toEqual(['new']);
  });

  it('keeps the newest preview count when an older filter request returns later', async () => {
    const pending: Array<(value: unknown) => void> = [];
    listCompetitions.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const page = makePage();
    page.data.morePanelVisible = true;
    const oldPreview = page.refreshMorePreview();
    page.data.draftFeeType = '免费';
    const newPreview = page.refreshMorePreview();
    expect(listCompetitions.mock.calls[1][0].feeType).toBe('免费');
    pending[1]({ items: [], total: 8, hasMore: false });
    await newPreview;
    pending[0]({ items: [], total: 30, hasMore: false });
    await oldPreview;
    expect(page.data.morePreviewCount).toBe(8);
  });
});
