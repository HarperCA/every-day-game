import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitGeneralFeedback, listGeneralFeedback } from '../apps/miniprogram/services/generalFeedback';
vi.mock('../apps/miniprogram/services/generalFeedback', async () => {
  const actual = await vi.importActual<any>('../apps/miniprogram/services/generalFeedback');
  return { ...actual, submitGeneralFeedback: vi.fn(), listGeneralFeedback: vi.fn() };
});
let form: any;
let records: any;
function create(definition: any) {
  return { ...definition, data: structuredClone(definition.data), setData(patch: any) { Object.assign(this.data, patch); } };
}
beforeAll(async () => {
  vi.stubGlobal('Page', (page: any) => { form = page; });
  await import('../apps/miniprogram/pages/general-feedback/general-feedback');
  vi.stubGlobal('Page', (page: any) => { records = page; });
  await import('../apps/miniprogram/pages/feedback-records/feedback-records');
});
beforeEach(() => {
  vi.mocked(submitGeneralFeedback).mockReset();
  vi.mocked(listGeneralFeedback).mockReset();
  vi.stubGlobal('getApp', () => ({ requestWechatLogin: vi.fn().mockResolvedValue(true) }));
  vi.stubGlobal('wx', { showToast: vi.fn(), showModal: vi.fn(), navigateTo: vi.fn(), getAccountInfoSync: () => ({ miniProgram: { version: '1.0.7' } }) });
});
describe('意见反馈提交与真实处理记录', () => {
  it('a later refresh cannot be overwritten by an older response', async () => {
    const page = create(records);
    let finish!: (value: any) => void;
    vi.mocked(listGeneralFeedback).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = page.loadRecords(true);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    vi.mocked(listGeneralFeedback).mockResolvedValueOnce({ items: [], total: 0, hasMore: false });
    await page.loadRecords(true);
    finish({ items: [{ id: 'old', type: 'bug', content: '旧数据', status: 'pending' }], total: 1, hasMore: false });
    await old;
    expect(page.data.records).toEqual([]);
    expect(page.data.total).toBe(0);
  });
  it('单字可提交，成功清空且提供查看记录入口', async () => {
    const page = create(form);
    page.setData({ content: '好', contact: ' hi ' });
    vi.mocked(submitGeneralFeedback).mockResolvedValue({});
    await page.submit();
    expect(submitGeneralFeedback).toHaveBeenCalledWith({ type: 'other', content: '好', contact: 'hi', appVersion: '1.0.7' });
    expect(page.data.content).toBe('');
    const dialog = vi.mocked(wx.showModal).mock.calls[0][0] as any;
    expect(dialog.content).toBe('反馈已收到，感谢你帮助我们改进竞赛雷达。');
    dialog.success({ confirm: true });
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/feedback-records/feedback-records' });
  });
  it('网络失败保留文字和联系信息并解除提交锁', async () => {
    const page = create(form);
    page.setData({ content: '筛选错误', contact: '微信abc' });
    vi.mocked(submitGeneralFeedback).mockRejectedValue(new Error('网络失败'));
    await page.submit();
    expect(page.data).toMatchObject({ content: '筛选错误', contact: '微信abc', submitting: false });
    expect(wx.showModal).not.toHaveBeenCalled();
  });
  it('拒绝空白内容和超长内容', async () => {
    const page = create(form);
    page.setData({ content: '  ' }); await page.submit();
    page.setData({ content: 'a'.repeat(2001) }); await page.submit();
    expect(submitGeneralFeedback).not.toHaveBeenCalled();
  });
  it('记录采用后台状态与公开回复，翻页失败保留已有记录', async () => {
    const page = create(records);
    vi.mocked(listGeneralFeedback).mockResolvedValue({ items: [
      { id: '1', type: 'bug', content: '地区有问题', contact: '', status: 'resolved', publicReply: '已修复地区筛选', createdAt: '2026-10-12T01:00:00Z', updatedAt: '2026-10-12T02:00:00Z' },
    ], total: 21, hasMore: true });
    await page.loadRecords(true);
    expect(page.data.records[0]).toMatchObject({ statusLabel: '已解决', publicReply: '已修复地区筛选' });
    vi.mocked(listGeneralFeedback).mockRejectedValue(new Error('网络失败'));
    await page.loadRecords(false);
    expect(page.data.records).toHaveLength(1);
    expect(page.data.page).toBe(1);
    expect(page.data.error).toBe('网络失败');
    expect(listGeneralFeedback).toHaveBeenLastCalledWith(2);
  });
});
