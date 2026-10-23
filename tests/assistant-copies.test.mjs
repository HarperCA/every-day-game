import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// 云开发部署时每个云函数只上传自己的目录，assistant 不能跨目录 require publicData 的筛选代码，只能复制一份。
// 复制品必须和 publicData 里的逐字一致，否则“找比赛”页和助手会查出不一样的结果。
const FILES = ['publicQuery.js', 'competitionRanking.js', 'competitionValue.js', 'majorKeywords.js', 'undergraduateMajors2026.json'];
const read = (fn, file) => fs.readFileSync(new URL(`../apps/miniprogram/cloudfunctions/${fn}/${file}`, import.meta.url), 'utf8');

describe('赛事助手：筛选代码的复制品', () => {
  for (const file of FILES) {
    it(`${file} 与 publicData 逐字一致`, () => {
      expect(read('assistant', file)).toBe(read('publicData', file));
    });
  }
});
