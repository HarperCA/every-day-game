// 新维护用到的 AI 用途（2026-11-08 用户定）：
//   没官网的比赛：DeepSeek 搜索 API 只搜比赛名（official_search），从前 10 条里让 DeepSeek 选（official_pick）；
//   写爬虫脚本：Codex（crawl_script），本地试跑时由试跑程序临时换成 Kimi；字段抽取沿用 04 的 extract（DeepSeek）。
// 走 AI 总管、照常记账。
import { expect, test } from 'vitest';
import { PURPOSES } from '../../config.mjs';
import { fakeSearcher, night, setup } from '../../../test/复用/假接口.mjs';

test('找官网：official_search 用 DeepSeek 搜索 API（按次计费），一次要 20 条；official_pick 用 DeepSeek 对话、不联网', () => {
  expect(PURPOSES.official_search).toMatchObject({ 能力: 'search', provider: 'deepseek', searchApi: 'tools', count: 20 });
  expect(PURPOSES.official_pick).toMatchObject({ 能力: 'chat', provider: 'deepseek', thinking: true });
  expect(PURPOSES.official_pick.webSearch).toBeUndefined();
  for (const 旧 of ['official_online', 'official_baidu', 'official_kimi', 'official_check']) expect(PURPOSES[旧], 旧).toBeUndefined();   // 方案三、DeepSeek 自己联网问都不用了
});

test('用途里的 searchApi、count 交给接口', async () => {
  const 搜 = fakeSearcher('deepseek', [['https://www.mcm.edu.cn/']]);
  const { ai } = setup({ extraProviders: { deepseek: 搜.provider } });
  await ai.session(night).search({ purpose: 'official_search', query: '全国大学生数学建模竞赛' });
  expect(搜.calls.at(-1)).toMatchObject({ query: '全国大学生数学建模竞赛', searchApi: 'tools', count: 20 });
});

test('写爬虫脚本：crawl_script 用 Codex', () => {
  expect(PURPOSES.crawl_script).toMatchObject({ 能力: 'chat', provider: 'codex', model: 'gpt-6.1-sol' });
});
