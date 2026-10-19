import { beforeEach, describe, expect, it, vi } from 'vitest';

const callPublicData = vi.fn();
const callUserData = vi.fn();
const isCloudSessionReady = vi.fn();
vi.mock('../apps/miniprogram/services/cloudSession', () => ({callPublicData, callUserData, isCloudSessionReady, getCurrentUserId:()=>''}));
vi.mock('../apps/miniprogram/services/publicRecord', () => ({hydratePublic:(record:any) => record}));
let stored: any;
let surveyStatus: any;

beforeEach(() => {
  vi.resetModules();
  callPublicData.mockReset();
  callUserData.mockReset();
  isCloudSessionReady.mockReset().mockReturnValue(true);
  stored = undefined;
  surveyStatus = undefined;
  vi.stubGlobal('wx', {
    getStorageSync:vi.fn((key) => key === 'competition-preferences-status-v1' ? surveyStatus : stored),
    setStorageSync:vi.fn((key, value) => { if (key === 'competition-preferences-status-v1') surveyStatus = value; else stored = structuredClone(value); }),
  });
});

describe('first-entry competition preference survey', () => {
  it('migrates legacy single selection only when no valid multiple selection exists', async () => {
    const {normalizeCompetitionPreferences:normalize} = await import('../apps/miniprogram/services/competitionPreferences');
    expect(normalize({profession:'计算机与AI',categories:['设计与艺术','设计与艺术']})).toMatchObject({profession:'',categories:['设计与艺术']});
    expect(normalize({profession:'计算机与AI',categories:['不存在']})).toMatchObject({profession:'',categories:['计算机与AI']});
    expect(normalize({profession:'不存在',categories:[]})).toMatchObject({profession:'',categories:[]});
  });

  it('restores account preferences including an unrestricted region without reviving duplicate single selection', async () => {
    stored = {profession:'',categories:[],province:'浙江省',dontShowAgain:false};
    callUserData.mockResolvedValue({profession:'计算机与AI',categories:['设计与艺术'],province:'',dontShowAgain:true,surveyStatus:'completed'});
    const service = await import('../apps/miniprogram/services/competitionPreferences');
    await service.syncCompetitionPreferencesAfterLogin();
    expect(service.loadCompetitionPreferences()).toEqual({profession:'',categories:['设计与艺术'],province:'',dontShowAgain:true});
    expect(surveyStatus).toBe('completed');
  });

  it('uploads completed local preferences after login and never uploads unanswered local drafts', async () => {
    const service = await import('../apps/miniprogram/services/competitionPreferences');
    service.saveCompetitionPreferences({profession:'计算机与AI',categories:[],province:'安徽省',dontShowAgain:false});
    expect(await service.uploadCompetitionPreferences()).toBe(false);
    expect(callUserData).not.toHaveBeenCalled();
    service.saveSurveyStatus('completed');
    await service.syncCompetitionPreferencesAfterLogin();
    expect(callUserData).toHaveBeenCalledWith('savePreferences',{preferences:{profession:'',categories:['计算机与AI'],province:'安徽省',dontShowAgain:false,surveyStatus:'completed'}});
    isCloudSessionReady.mockReturnValue(false);
    expect(await service.uploadCompetitionPreferences()).toBe(false);
    expect(callUserData).toHaveBeenCalledTimes(1);
  });

  it('shows once per session and remembers opt-out across launches while allowing manual editing', async () => {
    let service = await import('../apps/miniprogram/services/competitionPreferences');
    expect(service.shouldShowPreferenceSurvey()).toBe(true);
    expect(service.shouldShowPreferenceSurvey()).toBe(false);
    service.saveCompetitionPreferences({profession:'计算机与AI', categories:['计算机与AI','数学与统计'], province:'浙江省', dontShowAgain:true});
    vi.resetModules();
    service = await import('../apps/miniprogram/services/competitionPreferences');
    expect(service.shouldShowPreferenceSurvey()).toBe(false);
    expect(service.loadCompetitionPreferences().categories).toEqual(['计算机与AI','数学与统计']);
    service.requestPreferenceSurvey();
    expect(service.takePreferenceSurveyRequest()).toBe(true);
    expect(service.takePreferenceSurveyRequest()).toBe(false);
  });

  it('shows again next launch when opt-out is not checked and rejects invalid stored choices', async () => {
    let service = await import('../apps/miniprogram/services/competitionPreferences');
    service.shouldShowPreferenceSurvey();
    service.saveCompetitionPreferences({profession:'', categories:[], province:'', dontShowAgain:false});
    vi.resetModules();
    service = await import('../apps/miniprogram/services/competitionPreferences');
    expect(service.shouldShowPreferenceSurvey()).toBe(true);
    stored = {profession:'坏数据', categories:['计算机与AI','坏数据','计算机与AI'], province:'坏数据', dontShowAgain:'true'};
    expect(service.loadCompetitionPreferences()).toEqual({profession:'', categories:['计算机与AI'], province:'', dontShowAgain:false});
  });

  it('matches any selected category and includes national and uncertain regions alongside local competitions', async () => {
    const {matchesCompetitionPreferences:match} = await import('../apps/miniprogram/services/competitionPreferences');
    const categories = ['计算机与AI','数学与统计'];
    expect(match({professions:['数学与统计'],region:'全国'},categories,'浙江省')).toBe(true);
    expect(match({professions:['计算机与AI'],region:'浙江省杭州市'},categories,'浙江省')).toBe(true);
    expect(match({professions:['计算机与AI'],region:''},categories,'浙江省')).toBe(true);
    expect(match({professions:['计算机与AI'],region:'华东'},categories,'浙江省')).toBe(true);
    expect(match({professions:['计算机与AI'],region:'广东省'},categories,'浙江省')).toBe(false);
    expect(match({professions:['设计与艺术'],region:'全国'},categories,'浙江省')).toBe(false);
    expect(match({professions:['设计与艺术'],region:'广东省'},[],'')).toBe(true);
    expect(match({professions:['综合/不限专业'],region:'华东'},categories,'安徽省')).toBe(true);
    expect(match({professions:['综合/不限专业'],region:'广东省'},categories,'安徽省')).toBe(false);
    expect(match({professions:['计算机与AI'],region:'全国'},categories,'全国')).toBe(true);
    expect(match({professions:['计算机与AI'],region:'国际'},categories,'全国')).toBe(true);
    expect(match({professions:['计算机与AI'],region:''},categories,'全国')).toBe(true);
    expect(match({professions:['计算机与AI'],region:'福建省'},categories,'全国')).toBe(false);
    expect(match({professions:['计算机与AI'],region:'华北地区'},categories,'全国')).toBe(false);
  });

  it('filters the complete candidate set before pagination so matches beyond the first server page remain visible', async () => {
    const unrelated = Array.from({length:100},(_,index) => ({id:`other-${index}`,professions:['设计与艺术'],region:'广东省'}));
    const matches = [{id:'first',professions:['计算机与AI'],region:'全国'}, {id:'second',professions:['数学与统计'],region:'浙江省'}];
    callPublicData.mockResolvedValueOnce({items:unrelated,total:102,hasMore:true})
      .mockResolvedValueOnce({items:[...unrelated,...matches],total:102,hasMore:false});
    const {listCompetitions} = await import('../apps/miniprogram/services/repository');
    const result = await listCompetitions({competitionCategories:['计算机与AI','数学与统计'],preferenceProvince:'浙江省',page:1,pageSize:1});
    expect(result).toEqual({items:[matches[0]],total:2,hasMore:true});
    expect(callPublicData.mock.calls[1][1].query).toMatchObject({page:2,pageSize:100});
    expect(callPublicData.mock.calls[0][1].query.competitionCategories).toBeUndefined();
  });

  it('selecting 全国 keeps national, international and unspecified regions so a province never shows fewer than 全国', async () => {
    const items = [
      {id:'national',professions:['计算机与AI'],region:'全国'},
      {id:'intl',professions:['计算机与AI'],region:'国际'},
      {id:'blank',professions:['综合/不限专业'],region:''},
      {id:'fujian',professions:['计算机与AI'],region:'福建省'},
      {id:'liaoning',professions:['计算机与AI'],region:'辽宁省'},
    ];
    callPublicData.mockResolvedValue({items,total:items.length,hasMore:false});
    const {listCompetitions} = await import('../apps/miniprogram/services/repository');
    const national = await listCompetitions({competitionCategories:['计算机与AI'],region:'全国',page:1,pageSize:20});
    const fujian = await listCompetitions({competitionCategories:['计算机与AI'],region:'福建省',page:1,pageSize:20});
    expect(national.items.map((item:any) => item.id)).toEqual(['national','intl','blank']);
    expect(fujian.items.map((item:any) => item.id)).toEqual(['national','intl','blank','fujian']);
    expect(callPublicData.mock.calls[0][1].query.region).toBe('');
  });
});
