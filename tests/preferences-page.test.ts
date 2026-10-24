import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apps/miniprogram/services/cloudSession', () => ({isCloudSessionReady:()=>false,callUserData:vi.fn()}));
vi.mock('../apps/miniprogram/services/repository', () => ({getProfessionOptions:()=>['计算机与AI','电子信息'],listCompetitions:vi.fn(),listHomeCompetitions:vi.fn()}));
const definitions:any[] = [];
let storage:Map<string,any>;
function instance(definition:any) {
  return {...definition,data:structuredClone(definition.data),setData(patch:any, callback?:()=>void) {Object.assign(this.data,patch);callback?.();}};
}
beforeAll(async()=>{
  vi.stubGlobal('Page',(definition:any)=>definitions.push(definition));
  await import('../apps/miniprogram/pages/preferences/preferences');
  await import('../apps/miniprogram/pages/my/my');
  await import('../apps/miniprogram/pages/index/index');
});
beforeEach(()=>{
  storage = new Map([['competition-preferences-v1',{profession:'电子信息',categories:['电子信息'],province:'江苏省',dontShowAgain:true}]]);
  vi.stubGlobal('wx',{getStorageSync:vi.fn(key=>storage.get(key)),setStorageSync:vi.fn((key,value)=>storage.set(key,value)),navigateTo:vi.fn(),navigateBack:vi.fn(),switchTab:vi.fn(),showToast:vi.fn()});
});
describe('独立比赛偏好编辑页',()=>{
  it('从我的进入独立页，取消返回且不修改原偏好',()=>{
    instance(definitions.find(page=>page.openCompetitionPreferences)).openCompetitionPreferences();
    expect(wx.navigateTo).toHaveBeenCalledWith({url:'/pages/preferences/preferences'});
    expect(wx.switchTab).not.toHaveBeenCalled();
    const page = instance(definitions.find(page=>page.confirmStep));
    page.onLoad();
    page.onProvinceChange({detail:{value:[page.data.provinceOptions.indexOf('浙江省')]}});
    page.cancel();
    expect(wx.navigateBack).toHaveBeenCalled();
    expect(wx.setStorageSync).not.toHaveBeenCalled();
    expect(storage.get('competition-preferences-v1').profession).toBe('电子信息');
  });
  it('回填已有偏好，逐步修改后保存并返回原页',()=>{
    const page = instance(definitions.find(page=>page.confirmStep));
    page.onLoad();
    expect(page.data.provinceOptions[page.data.provinceIndex[0]]).toBe('江苏省');
    expect(page.data.categoryOptions.find((option:any)=>option.value==='电子信息').selected).toBe(true);
    expect(page.data.categories).toEqual(['电子信息']);
    page.onProvinceChange({detail:{value:[page.data.provinceOptions.indexOf('浙江省')]}});
    page.confirmStep();
    page.selectCategory({currentTarget:{dataset:{value:'电子信息'}}});
    page.selectCategory({currentTarget:{dataset:{value:'计算机与AI'}}});
    expect(wx.setStorageSync).not.toHaveBeenCalled();
    page.previousStep();
    expect(page.data.step).toBe(0);
    expect(page.data.provinceOptions[page.data.provinceIndex[0]]).toBe('浙江省');
    expect(page.data.categories).toEqual(['计算机与AI']);
    page.confirmStep();
    expect(page.data.step).toBe(1);
    page.confirmStep();
    expect(storage.get('competition-preferences-v1')).toEqual({profession:'',categories:['计算机与AI'],province:'浙江省',dontShowAgain:true});
    expect(wx.navigateBack).toHaveBeenCalled();
    expect(wx.switchTab).not.toHaveBeenCalled();
  });
  it('旧单选专业回填为第二步多选，取消不会覆盖存储',()=>{
    storage.set('competition-preferences-v1',{profession:'计算机与AI',categories:[],province:'安徽省',dontShowAgain:false});
    const page = instance(definitions.find(page=>page.confirmStep));
    page.onLoad();
    expect(page.data.step).toBe(0);
    expect(page.data.categories).toEqual(['计算机与AI']);
    expect(page.data.provinceOptions[page.data.provinceIndex[0]]).toBe('安徽省');
    page.confirmStep();
    page.selectCategory({currentTarget:{dataset:{value:''}}});
    expect(page.data.categories).toEqual([]);
    page.cancel();
    expect(wx.setStorageSync).not.toHaveBeenCalled();
    expect(storage.get('competition-preferences-v1').profession).toBe('计算机与AI');
  });
  it('只滑动专业后点击完成，中央选项也会实际保存',()=>{
    const page = instance(definitions.find(page=>page.confirmStep));
    page.onLoad();
    page.confirmStep();
    page.onCategoryChange({detail:{value:[1]}});
    page.confirmStep();
    expect(storage.get('competition-preferences-v1').categories).toEqual(['电子信息','计算机与AI']);
  });
  it('取消中央已选项目后完成，不会把项目重新加回',()=>{
    const page = instance(definitions.find(page=>page.confirmStep));
    page.onLoad();
    page.confirmStep();
    page.selectCategory({currentTarget:{dataset:{value:'计算机与AI'}}});
    page.onCategoryChange({detail:{value:[2]}});
    page.selectCategory({currentTarget:{dataset:{value:'电子信息'}}});
    page.confirmStep();
    expect(storage.get('competition-preferences-v1').categories).toEqual(['计算机与AI']);
  });
  it('滑动至不限并完成，清空此前的多选方向',()=>{
    const page = instance(definitions.find(page=>page.confirmStep));
    page.onLoad();
    page.confirmStep();
    page.selectCategory({currentTarget:{dataset:{value:'计算机与AI'}}});
    page.onCategoryChange({detail:{value:[0]}});
    page.confirmStep();
    expect(storage.get('competition-preferences-v1').categories).toEqual([]);
  });
  it('找比赛再次显示时应用新偏好，未修改时不重置筛选',()=>{
    const page = instance(definitions.find(page=>page.refreshCompetitionPreferences));
    page.preferenceSnapshot = JSON.stringify({profession:'计算机与AI',categories:[],province:'',dontShowAgain:true});
    page.load=vi.fn();
    page.refreshCompetitionPreferences();
    // 2026-10-24 首页改版：偏好直接成为当前的地区和专业大类，打开面板时显示为已选
    expect(page.data.categories).toEqual(['电子信息']);
    expect(page.data.region).toBe('江苏省');
    expect(page.load).toHaveBeenCalledTimes(1);
    page.data.region='浙江省';
    page.refreshCompetitionPreferences();
    expect(page.data.region).toBe('浙江省');
    expect(page.load).toHaveBeenCalledTimes(1);
  });
});
