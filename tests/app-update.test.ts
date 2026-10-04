import { describe, expect, it, vi } from 'vitest';
import { watchForUpdate } from '../apps/miniprogram/services/appUpdate';

function fakeApi(confirm: boolean) {
  const manager = { onUpdateReady: vi.fn(), onUpdateFailed: vi.fn(), applyUpdate: vi.fn() };
  const showModal = vi.fn((options: any) => options.success({ confirm }));
  return { api: { getUpdateManager: () => manager, showModal } as any, manager, showModal };
}

describe('新版小程序下载好后提示重启升级', () => {
  it('新版就绪才弹窗；用户点“重启升级”才重启', () => {
    const { api, manager, showModal } = fakeApi(true);
    watchForUpdate(api);
    expect(showModal).not.toHaveBeenCalled();
    manager.onUpdateReady.mock.calls[0][0]();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(showModal.mock.calls[0][0]).toMatchObject({ title: '新版本已就绪', confirmText: '重启升级', cancelText: '稍后' });
    expect(manager.applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('用户点“稍后”不重启', () => {
    const { api, manager } = fakeApi(false);
    watchForUpdate(api);
    manager.onUpdateReady.mock.calls[0][0]();
    expect(manager.applyUpdate).not.toHaveBeenCalled();
  });

  it('下载失败不弹窗、不报错', () => {
    const { api, manager, showModal } = fakeApi(true);
    watchForUpdate(api);
    expect(() => manager.onUpdateFailed.mock.calls[0][0]()).not.toThrow();
    expect(showModal).not.toHaveBeenCalled();
  });

  it('低版本基础库没有更新接口时直接跳过', () => {
    expect(() => watchForUpdate({ showModal: vi.fn() } as any)).not.toThrow();
  });
});
