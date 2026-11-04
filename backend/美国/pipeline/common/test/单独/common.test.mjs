// 流程内复用：读提示词、网址键、拒过的网址改动。不连网、不调 AI。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { tempRoot } from '../../../test/复用/假模块.mjs';
import { loadPrompt } from '../../prompt.mjs';
import { 网址键 } from '../../网址键.mjs';
import { 拒过改动 } from '../../拒过.mjs';

describe('读提示词', () => {
  const 写 = text => { const file = path.join(tempRoot(), 'prompt.md'); fs.writeFileSync(file, text, 'utf8'); return file; };
  test('第一行是版本号，其余是正文，{{变量}} 换成实际内容', () => {
    const file = 写('<!-- 版本：dedup-v1 -->\n判断下面 {{个数}} 条：\n{{候选}}\n');
    expect(loadPrompt(file, { 个数: 2, 候选: 'a\nb' })).toEqual({ version: 'dedup-v1', text: '判断下面 2 条：\na\nb' });
  });
  test('没写版本号、少给变量：报错', () => {
    expect(() => loadPrompt(写('没有版本号'))).toThrow('版本');
    expect(() => loadPrompt(写('<!-- 版本：v1 -->\n{{候选}}'), {})).toThrow('候选');
  });
});

describe('网址键', () => {
  test('不分 http/https、去掉 www、结尾斜杠、# 锚点和跟踪参数，保留路径和其他参数', () => {
    expect(网址键('https://www.Example.cn/a/b/?id=3&utm_source=x#top')).toBe('example.cn/a/b?id=3');
    expect(网址键('http://example.cn/a/b?id=3')).toBe('example.cn/a/b?id=3');
    expect(网址键('https://example.cn/')).toBe('example.cn');
  });
  test('不是网址：交回空字符串', () => {
    expect(网址键('')).toBe('');
    expect(网址键('ftp://a.cn/x')).toBe('');
    expect(网址键('不是网址')).toBe('');
  });
});

describe('拒过的网址改动', () => {
  test('丢弃候选时顺带提一条：新增进比赛库的 rejected_url，挂在这个条目上', () => {
    const item = { key: 'https://a.cn/n', kind: 'candidate', data: { name: '某页面', url: 'https://www.a.cn/n/' } };
    expect(拒过改动({ item, 原因: '不是比赛', module: '03-filter', runId: '2026-10-31', now: new Date('2026-10-31T01:00:00Z') })).toEqual({
      table: 'rejected_url', key: '2026-10-31:a.cn/n', op: 'insert', itemKey: 'https://a.cn/n',
      payload: { url: 'https://www.a.cn/n/', url_key: 'a.cn/n', title: '某页面', reason: '不是比赛', module: '03-filter', run_id: '2026-10-31', rejected_at: '2026-10-31T01:00:00.000Z' },
    });
  });
  test('网址不合规：不提（交回 null）', () => {
    expect(拒过改动({ item: { key: 'k', data: { url: '不是网址' } }, 原因: 'x', module: '05-review', runId: 'r', now: new Date() })).toBeNull();
  });
});
