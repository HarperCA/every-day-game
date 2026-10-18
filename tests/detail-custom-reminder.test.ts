import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ records:vi.fn(), save:vi.fn(), remove:vi.fn() }));
vi.mock('../apps/miniprogram/services/repository', () => ({getCompetition:vi.fn()}));
vi.mock('../apps/miniprogram/services/favorites', () => ({isFavorite:()=>false,toggleFavorite:vi.fn()}));
vi.mock('../apps/miniprogram/services/reminders', () => ({getRemindersForEdition:mocks.records,removeRemindersForEdition:mocks.remove,saveReminderPlansWithAuthorization:mocks.save}));
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

// 自定义提醒的可选范围（2026-10-17）：今天到截止日；今天从现在往后；截止日当天到截止时刻之前；超出范围自动挪回
it('limits the custom reminder to between now and the deadline',()=>{
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T19:40:00'));
  try {
    const instance=page();
    instance.data.reminderEvents=[{value:'registration_end',available:true,label:'报名截止',targetAt:'2026-10-20T18:00:00'}];
    instance.applyCustomBounds('2026-10-18','09:00');
    expect(instance.data).toMatchObject({customMinDate:'2026-10-17',customMaxDate:'2026-10-20',customMinTime:'00:00',customMaxTime:'23:59',customDate:'2026-10-18',customTime:'09:00'});
    instance.onCustomDateChange({detail:{value:'2026-10-17'}});
    expect(instance.data).toMatchObject({customDate:'2026-10-17',customMinTime:'19:41',customTime:'19:41'});
    instance.onCustomDateChange({detail:{value:'2026-10-20'}});
    expect(instance.data).toMatchObject({customDate:'2026-10-20',customMinTime:'00:00',customMaxTime:'17:59',customTime:'17:59'});
    instance.onCustomTimeChange({detail:{value:'23:30'}});
    expect(instance.data.customTime).toBe('17:59');
    instance.onCustomDateChange({detail:{value:'2026-10-25'}});
    expect(instance.data.customDate).toBe('2026-10-20');
    instance.onCustomDateChange({detail:{value:'2026-10-01'}});
    expect(instance.data.customDate).toBe('2026-10-17');
  } finally { vi.useRealTimers(); }
});

// 底部铃铛（2026-10-18）：已有提醒时点一下直接取消；没有提醒时打开设置面板
it('cancels existing reminders with one tap and opens the editor when there are none',async()=>{
  const instance=page();
  instance.data.reminderCount=2;
  mocks.records.mockReturnValue([]);
  await instance.toggleReminder();
  expect(mocks.remove).toHaveBeenCalledWith('event');
  expect(instance.data.reminderCount).toBe(0);
  expect(wx.showToast).toHaveBeenCalledWith({title:'已取消提醒',icon:'none'});
  mocks.remove.mockClear();
  const opened=vi.fn();instance.openReminderPanel=opened;
  await instance.toggleReminder();
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(opened).toHaveBeenCalled();
});

// 复制报名链接后的提示里带上报名方式（2026-10-18）
it('shows the registration method after copying the link',()=>{
  const instance=page();
  const modal=vi.fn();
  vi.stubGlobal('wx',{showToast:vi.fn(),showModal:modal,setClipboardData:({success}:any)=>success()});
  instance.data.item={id:'event',name:'比赛',registrationUrl:'http://www.mooctest.net/',registrationUrlUsable:true,fieldText:{registrationMethod:'进入慕测平台，选择“测试大赛”报名'}};
  instance.copyRegistrationUrl();
  expect(modal.mock.calls[0][0].content).toContain('报名方式：进入慕测平台，选择“测试大赛”报名');
  instance.data.item.fieldText.registrationMethod='信息不足';
  instance.copyRegistrationUrl();
  expect(modal.mock.calls[1][0].content).toBe('链接已复制，请在浏览器中打开并核对主办单位。');
});
