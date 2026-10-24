// 微信 AI 的 SKILL（2026-10-24）：查详情配接力页面；助手提示词要求问细节时不说“库里没有”
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('SKILL 接力页面', () => {
  it('getCompetitionDetail 声明接力到比赛详情页（页面存在于 app.json）', () => {
    const mcp = JSON.parse(fs.readFileSync('apps/miniprogram/skills/competition/mcp.json', 'utf8'));
    const detail = mcp.apis.find(api => api.name === 'getCompetitionDetail');
    expect(detail._meta.ui.pagePath).toBe('/pages/detail/detail');
    expect(JSON.parse(fs.readFileSync('apps/miniprogram/app.json', 'utf8')).pages).toContain('pages/detail/detail');
  });
  it('返回 handoff：带上比赛 id，详情页按 id 打开', async () => {
    const serverPath = require.resolve('../apps/miniprogram/skills/competition/apis/server.js');
    const detailPath = require.resolve('../apps/miniprogram/skills/competition/apis/getCompetitionDetail.js');
    delete require.cache[serverPath]; delete require.cache[detailPath];
    require.cache[serverPath] = { id:serverPath, filename:serverPath, loaded:true, exports:{ getCompetition:async () => ({ id:'edition 1', name:'比赛', organizer:'组委会', registration_status:'报名中' }) } };
    const getCompetitionDetail = require(detailPath);
    const result = await getCompetitionDetail({ id:'edition-1' });
    expect(result.isError).toBe(false);
    expect(result.handoff()).toEqual({ query:'id=edition%201' });
    expect(result.content[0].text).toContain('主办方：组委会');
    delete require.cache[serverPath]; delete require.cache[detailPath];
  });
});

describe('助手提示词', () => {
  it('问比赛细节：工具结果里有的照抄，没有的引导看详情页，不说库里没有', () => {
    const { systemPrompt, PROMPT_VERSION } = require('../apps/miniprogram/cloudfunctions/assistant/prompt.js');
    const text = systemPrompt({ now:new Date('2026-10-24T00:00:00Z') });
    expect(text).toContain('不要说赛事库里没有这项信息');
    expect(PROMPT_VERSION).toBe('assistant-v2');
  });
});
