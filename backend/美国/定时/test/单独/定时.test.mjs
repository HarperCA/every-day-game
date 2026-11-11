// 定时：美国服务器上的 systemd 定时器，时间一律按北京时间（服务器是 UTC）。2026-11-01 用户定：
//   每晚流程 每天 1:00；维护 每天 9:00–18:00 每 5 分钟一次（每次一个比赛）；回收站清理 每天 0:30；建议屏蔽的网站 每周一 9:00。
// 这里只检查仓库里的配置文件写得对；装到服务器上是部署，要用户同意。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND = path.resolve(DIR, '..', '..');
const 读 = name => fs.readFileSync(path.join(DIR, name), 'utf8');
const 项 = (text, key) => [...text.matchAll(new RegExp(`^${key}=(.*)$`, 'gm'))].map(m => m[1].trim());

const 任务们 = [
  { 名: 'competition-radar-pipeline', 时间: '*-*-* 01:00:00 Asia/Shanghai', 脚本: '美国/pipeline/run.mjs' },
  { 名: 'competition-radar-maintain', 时间: '*-*-* 09..17:00/5:00 Asia/Shanghai', 脚本: '美国/db/维护/run.mjs' },
  { 名: 'competition-radar-cleanup', 时间: '*-*-* 00:30:00 Asia/Shanghai', 脚本: '美国/后台/每日清理.mjs' },
  // 每天 2:00 把报名已截止的已发布届次归档、算下一届预计（2026-11-03，接替旧系统 daily-contest-archive.timer，时间同旧的）
  { 名: 'competition-radar-archive', 时间: '*-*-* 02:00:00 Asia/Shanghai', 脚本: '美国/db/维护/归档/run.mjs' },
  // 每周一 9:00 统计建议屏蔽的网站（2026-11-02 搬自旧系统的 daily-contest-site-block.timer）
  { 名: 'competition-radar-site-block', 时间: 'Mon *-*-* 09:00:00 Asia/Shanghai', 脚本: '美国/屏蔽网站建议/run.mjs' },
  // 每 5 分钟把已公开的比赛推到北京（2026-11-02，接替旧系统 daily-contest-public-sync.timer）
  { 名: 'competition-radar-public-sync', 时间: '*-*-* *:00/5:00', 脚本: '沟通/公开比赛同步/美国端.mjs' },
  // AI 审查：约每 5 小时 100 个比赛，避开每晚流程的 1:00（2026-11-06 用户定）
  { 名: 'competition-radar-ai-review', 时间: '*-*-* 02,07,12,17,22:00:00 Asia/Shanghai', 脚本: '美国/db/维护/run.mjs', 参数: ' --批 100' },
  // 后台多选的比赛：每 2 分钟看一眼队列，空的马上退出（2026-11-06 用户定）
  { 名: 'competition-radar-ai-queue', 时间: '*-*-* *:00/2:00', 脚本: '美国/db/维护/run.mjs', 参数: ' --队列' },
];

describe('定时器', () => {
  test.each(任务们)('$名：按北京时间 $时间 启动；错过了不补跑', ({ 名, 时间 }) => {
    const timer = 读(`${名}.timer`);
    expect(项(timer, 'OnCalendar')).toEqual([时间]);
    expect(项(timer, 'Persistent')).toEqual(['false']);
    expect(项(timer, 'Unit')).toEqual([`${名}.service`]);
  });
  test.each(任务们)('$名：服务跑的是仓库里真有的脚本，环境变量从服务器上的 env 文件读（值不进仓库）', ({ 名, 脚本, 参数 = '' }) => {
    const service = 读(`${名}.service`);
    expect(项(service, 'Type')).toEqual(['oneshot']);
    expect(项(service, 'EnvironmentFile')).toEqual(['/etc/competition-radar/env']);
    expect(项(service, 'ExecStart')).toEqual([`/usr/bin/env node \${BACKEND_DIR}/${脚本}${参数}`]);
    expect(fs.existsSync(path.join(BACKEND, 脚本)), 脚本).toBe(true);
  });
  test('有说明：装法、时间表、要设哪些环境变量', () => {
    const readme = 读('README.md');
    for (const 词 of ['1:00', '2:00', '9:00', '18:00', '0:30', '每周一', '归档', 'AI 审查', 'BACKEND_DIR', 'systemctl']) expect(readme).toContain(词);
  });
  test('新维护每天 10:00 启动，使用部署环境和正式维护入口', () => {
    const timer = 读('competition-radar-maintain-new.timer');
    expect(项(timer, 'OnCalendar')).toEqual(['*-*-* 10:00:00 Asia/Shanghai']);
    expect(项(timer, 'Persistent')).toEqual(['false']);
    const service = 读('competition-radar-maintain-new.service');
    expect(项(service, 'EnvironmentFile')).toEqual(['/etc/competition-radar/env']);
    expect(项(service, 'ExecStart')[0]).toContain('美国/db/新维护/运行.mjs --上限 45 --并发 4');
    expect(项(service, 'TimeoutStartSec')).toEqual(['3h']);
    expect(fs.existsSync(path.join(BACKEND, '美国/db/新维护/运行.mjs'))).toBe(true);
  });
  test('部署说明只启用新维护和后台 AI 队列，不启用旧维护、批量审查或补缺失', () => {
    const 启用行 = 读('README.md').split('\n').find(line => line.startsWith('sudo systemctl enable --now '));
    expect(启用行).toContain('competition-radar-maintain-new.timer');
    expect(启用行).toContain('competition-radar-ai-queue.timer');
    expect(启用行).not.toMatch(/competition-radar-(?:maintain|ai-review|fill)\.timer/);
  });
});
