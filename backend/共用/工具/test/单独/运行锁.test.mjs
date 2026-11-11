import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { tempRoot } from '../../../test/复用/临时目录.mjs';
import { 拿锁 } from '../../运行锁.mjs';

const 执行 = promisify(execFile);
const 后端 = new URL('../../../../', import.meta.url);
const 旧维护 = fileURLToPath(new URL('美国/db/维护/run.mjs', 后端));
const 新维护 = fileURLToPath(new URL('美国/db/新维护/运行.mjs', 后端));
const 锁模块 = new URL('../../运行锁.mjs', import.meta.url).href;

test('旧维护跳过持锁的一轮，新维护在持锁进程被杀死后继续运行', async () => {
  const 目录 = tempRoot();
  const 维护日志 = path.join(目录, '维护日志');
  const env = {
    ...process.env,
    MAINTAIN_LOG_DIR: 维护日志,
    PIPELINE_LOG_DIR: path.join(目录, '流程日志'),
    DB_DIR: path.join(目录, '比赛库'),
    AI_USAGE_DB: path.join(目录, '用量.db'),
  };
  const 持锁 = spawn(process.execPath, ['--input-type=module', '-e', [
    'import { 拿锁 } from ' + JSON.stringify(锁模块),
    'const 放锁 = 拿锁(process.env.MAINTAIN_LOG_DIR)',
    'if (!放锁) process.exit(1)',
    'process.once("exit", 放锁)',
    'console.log("ready")',
    'setInterval(() => {}, 1000)',
  ].join('\n')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const 持锁结束 = once(持锁, 'exit');
  let 等锁;
  try {
    const 已持锁 = once(持锁.stdout, 'data').then(([输出]) => String(输出).trim());
    expect(await Promise.race([已持锁, 持锁结束])).toBe('ready');

    const 旧结果 = await 执行(process.execPath, [旧维护, '--比赛', 'test-event'], { env, timeout: 4000 });
    expect(旧结果.stdout).toContain('上一次维护还没完，这一轮跳过');
    expect(fs.existsSync(env.DB_DIR)).toBe(false);

    等锁 = spawn(process.execPath, [新维护, '--上限', '0'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
    const 等锁结束 = once(等锁, 'exit');
    let 输出 = '';
    等锁.stdout.on('data', chunk => { 输出 += String(chunk); });
    const 等待输出 = once(等锁.stdout, 'data').then(([chunk]) => String(chunk));
    expect(await Promise.race([等待输出, 等锁结束])).toContain('等待每日流程或其他维护完成');
    expect(fs.existsSync(env.DB_DIR)).toBe(false);

    持锁.kill('SIGKILL');
    await 持锁结束;
    expect(await 等锁结束).toEqual([0, null]);
    expect(输出).toContain('跑完 0 个');
    const 放锁 = 拿锁(维护日志);
    expect(放锁).toBeTypeOf('function');
    放锁();
  } finally {
    持锁.kill('SIGKILL');
    等锁?.kill('SIGKILL');
  }
}, 15000);
