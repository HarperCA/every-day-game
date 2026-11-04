// AI 总管骨架：只管接口的统一管理和分发。检查入口、分发配置、目录和引用规矩。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { importsOf, relTo, walk } from '../../../../共用/test/复用/扫描引用.mjs';
import * as ai from '../../index.mjs';

const AI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = file => relTo(AI_DIR, file);

describe('结构', () => {
  const PROVIDERS = ['baidu', 'codex', 'deepseek', 'jev', 'kimi'];
  const CAPS = ['chat', 'search', 'fetchPage', 'decide'];
  test('providers/ 下正好是这 5 家，每家都有 README.md 和 index.mjs，至少会一种能力', async () => {
    const dirs = fs.readdirSync(path.join(AI_DIR, 'providers'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
    expect(dirs).toEqual(PROVIDERS);
    for (const name of PROVIDERS) {
      expect(fs.existsSync(path.join(AI_DIR, 'providers', name, 'README.md')), `${name}/README.md`).toBe(true);
      const p = await import(`../../providers/${name}/index.mjs`);
      expect(p.name).toBe(name);
      expect(CAPS.filter(c => typeof p[c] === 'function').length, `${name} 的能力`).toBeGreaterThan(0);
      expect(typeof p.classifyError).toBe('function');
    }
  });
  test('每个用途的能力都认识；指向的每一家（补位的也算）都会这种能力（还没定的留空）', async () => {
    for (const [purpose, cfg] of Object.entries(ai.PURPOSES)) {
      expect(CAPS, `用途 ${purpose} 的能力`).toContain(cfg.能力);
      for (const name of [cfg.provider].flat().filter(Boolean)) {
        const p = await import(`../../providers/${name}/index.mjs`);
        expect(typeof p[cfg.能力], `用途 ${purpose} → ${name}.${cfg.能力}`).toBe('function');
      }
    }
  });
  test('AI 总管里不放具体任务：没有提示词文件，也没有任务文件夹', () => {
    const all = fs.readdirSync(AI_DIR, { recursive: true }).map(String);
    expect(all.filter(f => /prompt\.md$|[\\/]tools[\\/]/.test(f))).toEqual([]);
  });
});

describe('引用规矩', () => {
  const violations = [];
  for (const file of walk(AI_DIR)) {
    const from = rel(file);
    for (const target of importsOf(file)) {
      const to = rel(target);
      if (to.startsWith('..') && !to.startsWith('../../共用/工具/')) violations.push(`${from} 引用了 AI 总管外面的 ${to}（外面只能用 共用/工具/）`);
      if (from.startsWith('providers/')) {
        const own = from.split('/').slice(0, 2).join('/');
        if (!to.startsWith(own + '/') && !to.startsWith('common/')) violations.push(`${from} 引用了 ${to}（每家接口只能用自己文件夹和 common/）`);
      }
    }
  }
  test('没有违反引用规矩', () => expect(violations).toEqual([]));
});
