// 组队申请（2026-11-05；11-12 接北京后端）：从组队页的方框按钮进来（订阅消息点开也到这里），分两栏：
// 待我审批（只有队长：申请人头像昵称、专业、年级、擅长方向、介绍，通过/拒绝）、我发出的（审核中可以撤回）。
import { decideApplication, listInboundApplications, listOutboundApplications, withdrawApplication } from '../../services/teams';

const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : '操作失败');
function confirmModal(title: string, confirmText: string): Promise<boolean> {
  return new Promise(resolve => wx.showModal({ title, confirmText, confirmColor: '#c24141', success: (result: any) => resolve(Boolean(result?.confirm)), fail: () => resolve(false) }));
}

Page({
  data: { tab: 'inbound', inbound: [] as any[], outbound: [] as any[], loading: true, error: '' },
  onShow() { return this.refresh(); },
  async refresh() {
    try {
      const [inbound, outbound] = await Promise.all([listInboundApplications(), listOutboundApplications()]);
      this.setData({ inbound, outbound, loading: false, error: '' });
    } catch (error) {
      this.setData({ loading: false, error: errorText(error) });
    }
  },
  setTab(event: WechatMiniprogram.TouchEvent) { this.setData({ tab: event.currentTarget.dataset.tab }); },
  noop() {},
  openTeam(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/team-detail/team-detail?id=${encodeURIComponent(String(event.currentTarget.dataset.id))}` });
  },
  async attempt(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      wx.showToast({ title: done, icon: 'none' });
    } catch (error) { wx.showToast({ title: errorText(error), icon: 'none' }); }
    await this.refresh();
  },
  approve(event: WechatMiniprogram.TouchEvent) {
    return this.attempt(() => decideApplication(String(event.currentTarget.dataset.id), 'approve'), '已通过，队友已加入');
  },
  async reject(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    if (await confirmModal('拒绝这条申请？', '拒绝')) await this.attempt(() => decideApplication(id, 'reject'), '已拒绝');
  },
  async withdraw(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    if (await confirmModal('撤回这条申请？', '撤回')) await this.attempt(() => withdrawApplication(id), '已撤回');
  },
});
