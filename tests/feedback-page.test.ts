import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { callUserData } from '../apps/miniprogram/services/cloudSession';

vi.mock('../apps/miniprogram/services/cloudSession', () => ({ callUserData: vi.fn() }));
vi.mock('../apps/miniprogram/services/repository', () => ({ listCompetitions: vi.fn().mockResolvedValue({ items: [] }) }));

let definition: any;
function createPage() {
  return { ...definition, data: structuredClone(definition.data), setData(patch: any) { Object.assign(this.data, patch); } };
}
beforeAll(async () => {
  vi.stubGlobal('Page', (page: any) => { definition = page; });
  await import('../apps/miniprogram/pages/feedback/feedback');
});
beforeEach(() => {
  vi.mocked(callUserData).mockReset();
  vi.stubGlobal('wx', { showToast: vi.fn(), showModal: vi.fn(), setNavigationBarTitle: vi.fn() });
  vi.stubGlobal('getApp', () => ({ requestWechatLogin: vi.fn().mockResolvedValue(true) }));
});

describe('纠错提交与个人记录分开展示', () => {
  it('从比赛进入时不查询历史报错，提交后也不加载记录', async () => {
    const page = createPage();
    page.onLoad({ id: 'edition-1', name: encodeURIComponent('比赛一') });
    await page.onShow();
    expect(callUserData).not.toHaveBeenCalled();
    page.setData({ content: '报名时间有问题' });
    vi.mocked(callUserData).mockResolvedValue({} as any);
    await page.submit();
    expect(callUserData).toHaveBeenCalledTimes(1);
    expect(callUserData).toHaveBeenCalledWith('submitFeedback', expect.objectContaining({ editionId: 'edition-1', content: '报名时间有问题' }));
    expect(page.data.content).toBe('');
    expect(page.data.records).toEqual([]);
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({ title: '纠错已提交' }));
  });

  it('从我的进入查询所有赛事的报错，并按最新提交排序', async () => {
    const page = createPage();
    const records = [
      { id: 'old', competitionName: '比赛甲', category: 'time', content: '旧记录', status: 'accepted', createdAt: '2026-10-01T01:00:00Z' },
      { id: 'new', competitionName: '比赛乙', category: 'rules', content: '新记录', status: 'human_reviewing', createdAt: '2026-10-12T01:00:00Z' },
    ];
    vi.mocked(callUserData).mockResolvedValue(records as any);
    page.onLoad({});
    await page.onShow();
    await vi.waitFor(() => expect(page.data.records).toHaveLength(2));
    expect(callUserData).toHaveBeenCalledWith('listFeedback');
    expect(page.data.records.map((record: any) => record.id)).toEqual(['new', 'old']);
    expect(page.data.records[0]).toMatchObject({ competitionName: '比赛乙', categoryLabel: '比赛规则', statusLabel: '管理员复核中' });
    expect(page.data.records[1].statusLabel).toBe('已采纳');
    expect(records.map(record => record.id)).toEqual(['old', 'new']);
  });

  it('记录查询失败时显示登录提示且结束加载', async () => {
    const page = createPage();
    vi.mocked(callUserData).mockRejectedValue(new Error('not logged in'));
    page.onLoad({});
    await page.onShow();
    await vi.waitFor(() => expect(page.data.recordsHint).toContain('登录'));
    expect(page.data.recordsLoading).toBe(false);
    expect(page.data.records).toEqual([]);
  });
});
