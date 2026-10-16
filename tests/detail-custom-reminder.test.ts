import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ records:vi.fn(), save:vi.fn() }));
vi.mock('../apps/miniprogram/services/repository', () => ({getCompetition:vi.fn()}));
vi.mock('../apps/miniprogram/services/favorites', () => ({isFavorite:()=>false,toggleFavorite:vi.fn()}));
vi.mock('../apps/miniprogram/services/reminders', () => ({getRemindersForEdition:mocks.records,removeRemindersForEdition:vi.fn(),saveReminderPlansWithAuthorization:mocks.save}));
let definition:any;
beforeAll(async () => {
  vi.stubGlobal('Page',(page:any)=>{definition=page;});
  await import('../apps/miniprogram/pages/detail/detail');
});
beforeEach(() => {
  mocks.records.mockReturnValue([]);
  mocks.save.mockReset().mockResolvedValue({status:'accepted',plans:[]});
  vi.stubGlobal('wx',{showToast:vi.fn(),showModal:vi.fn()});
  vi.stubGlobal('getApp',()=>({globalData:{reminderTemplateId:'template'},requestWechatLogin:async()=>true}));
});
function page() {
  return {...definition,data:{...structuredClone(definition.data),item:{id:'event',name:'比赛'},reminderEvents:[{value:'registration_end',available:true,label:'报名截止',targetAt:'2099-12-31T23:59:00+08:00'}]},setData(patch:any,callback?:()=>void){Object.assign(this.data,patch);callback?.();}};
}
it('fills the actual time from a legacy preset without writing records',()=>{
  mocks.records.mockReturnValue([{eventType:'registration_end',advanceKey:'1d',remindAt:'2099-12-30T09:00:00'}]);
  const instance=page();instance.refreshReminderOptions();
  expect(instance.data.customDate).toBe('2099-12-30');
  expect(instance.data.customTime).toBe('09:00');
  expect(mocks.save).not.toHaveBeenCalled();
});
it('saves only the selected custom time and never adds a confirmation modal',async()=>{
  const instance=page();
  instance.onCustomDateChange({detail:{value:'2099-12-29'}});
  instance.onCustomTimeChange({detail:{value:'10:30'}});
  await instance.saveReminder();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({presets:[],customAt:new Date('2099-12-29T10:30:00').toISOString()}),'template');
  expect(wx.showModal).not.toHaveBeenCalled();
  expect(instance.data.reminderPanelVisible).toBe(false);
});
it('keeps the editor open and input intact when authorization is denied',async()=>{
  mocks.save.mockResolvedValue({status:'rejected',plans:[]});
  const instance=page();Object.assign(instance.data,{reminderPanelVisible:true,customDate:'2099-12-29',customTime:'10:30'});
  await instance.saveReminder();
  expect(instance.data).toMatchObject({reminderPanelVisible:true,customDate:'2099-12-29',customTime:'10:30',savingReminder:false});
});
