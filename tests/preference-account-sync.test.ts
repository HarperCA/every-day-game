import { beforeEach, describe, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ owner: 'a', call: vi.fn() }));
vi.mock('../apps/miniprogram/services/cloudSession', () => ({
  isCloudSessionReady: () => !!session.owner,
  getCurrentUserId: () => session.owner,
  callUserData: session.call,
}));
const storage = new Map<string, unknown>();
beforeEach(() => {
  vi.resetModules(); session.owner = 'a'; session.call.mockReset(); storage.clear();
  vi.stubGlobal('wx', { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: any) => storage.set(key, value) });
});
describe('preference account isolation', () => {
  it('keeps different accounts separate instead of uploading the previous account answers', async () => {
    const service = await import('../apps/miniprogram/services/competitionPreferences');
    service.saveCompetitionPreferences({ profession: '', categories: ['计算机与AI'], province: '安徽省', dontShowAgain: true });
    service.saveSurveyStatus('completed');
    await service.syncCompetitionPreferencesAfterLogin();
    session.call.mockClear(); session.owner = 'b'; session.call.mockResolvedValue(null);
    await service.syncCompetitionPreferencesAfterLogin();
    expect(session.call).toHaveBeenCalledWith('getPreferences');
    expect(session.call).not.toHaveBeenCalledWith('savePreferences', expect.anything());
    expect(service.loadCompetitionPreferences().categories).toEqual([]);
    session.owner = 'a';
    expect(service.loadCompetitionPreferences().categories).toEqual(['计算机与AI']);
  });
  it('migrates guest answers only to the first account', async () => {
    const service = await import('../apps/miniprogram/services/competitionPreferences');
    session.owner = '';
    service.saveCompetitionPreferences({ profession: '', categories: ['数学与统计'], province: '浙江省', dontShowAgain: false });
    service.saveSurveyStatus('completed');
    session.owner = 'a'; await service.syncCompetitionPreferencesAfterLogin();
    expect(session.call).toHaveBeenCalledWith('savePreferences', expect.objectContaining({ preferences: expect.objectContaining({ categories: ['数学与统计'] }) }));
    session.call.mockClear(); session.owner = 'b'; session.call.mockResolvedValue(null);
    await service.syncCompetitionPreferencesAfterLogin();
    expect(service.loadCompetitionPreferences().categories).toEqual([]);
    expect(session.call).toHaveBeenCalledTimes(1);
  });
  it('does not save an old account preference response into a newer account', async () => {
    const service = await import('../apps/miniprogram/services/competitionPreferences');
    let finish!: (value: any) => void;
    session.call.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = service.syncCompetitionPreferencesAfterLogin();
    const rejected = expect(pending).rejects.toThrow('账号已变更');
    session.owner = 'b'; finish({ categories: ['计算机与AI'], surveyStatus: 'completed' });
    await rejected;
    expect(storage.has('competition-preferences-v1:b')).toBe(false);
  });
});
