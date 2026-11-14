// 定时：美国服务器上的 systemd 定时器，时间一律按北京时间（服务器是 UTC）。2026-11-01 用户定：
//   每晚流程 每天 1:00；回收站清理 每天 0:30；建议屏蔽的网站 每周一 9:00。
//   2026-11-12 用户定：旧 AI 审查（维护/run.mjs 的 --批、--队列）和轮流维护删掉；后台多选的队列改由新维护的队列模式处理。
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
  { 名: 'competition-radar-cleanup', 时间: '*-*-* 00:30:00 Asia/Shanghai', 脚本: '美国/后台/每日清理.mjs' },
  // 每天 2:00 把报名已截止的已发布届次归档、算下一届预计（2026-11-03，接替旧系统 daily-contest-archive.timer，时间同旧的）
  { 名: 'competition-radar-archive', 时间: '*-*-* 02:00:00 Asia/Shanghai', 脚本: '美国/db/维护/归档/run.mjs' },
  // 每周一 9:00 统计建议屏蔽的网站（2026-11-02 搬自旧系统的 daily-contest-site-block.timer）
  { 名: 'competition-radar-site-block', 时间: 'Mon *-*-* 09:00:00 Asia/Shanghai', 脚本: '美国/屏蔽网站建议/run.mjs' },
  // 每 5 分钟把已公开的比赛推到北京（2026-11-02，接替旧系统 daily-contest-public-sync.timer）
  { 名: 'competition-radar-public-sync', 时间: '*-*-* *:00/5:00', 脚本: '沟通/公开比赛同步/美国端.mjs' },
  // 新维护：每天 10:00 按调度挑到期的，最多 45 个、同时 4 个（2026-11-09 线上，11-12 补进仓库）；报告一次一个文件
  { 名: 'competition-radar-maintain-new', 时间: '*-*-* 10:00:00 Asia/Shanghai', 脚本: '美国/db/新维护/运行.mjs',
    命令: '/bin/bash -c "exec /usr/bin/env node ${BACKEND_DIR}/美国/db/新维护/运行.mjs --上限 45 --并发 4 --报告 /opt/competition-radar/logs/maintain-new/$$(date +%%F-%%H%%M).json"' },
  // 后台多选的比赛：每 2 分钟看一眼队列，空的马上退出（2026-11-06）；2026-11-12 改由新维护的队列模式处理，报告和每日那次放一起、文件名带“队列-”
  { 名: 'competition-radar-ai-queue', 时间: '*-*-* *:00/2:00', 脚本: '美国/db/新维护/运行.mjs',
    命令: '/bin/bash -c "exec /usr/bin/env node ${BACKEND_DIR}/美国/db/新维护/运行.mjs --队列 --并发 4 --报告 /opt/competition-radar/logs/maintain-new/队列-$$(date +%%F-%%H%%M).json"' },
  // 找新一届：每天 14:00（每日新维护 10:00 之后；共用维护锁，那边没跑完就等），挑已归档、预计报名时间临近或已过、7 天内没找过的，最多 30 个（2026-11-12 用户定）
  { 名: 'competition-radar-new-edition', 时间: '*-*-* 14:00:00 Asia/Shanghai', 脚本: '美国/db/新维护/运行.mjs',
    命令: '/bin/bash -c "exec /usr/bin/env node ${BACKEND_DIR}/美国/db/新维护/运行.mjs --找新一届 --上限 30 --并发 4 --报告 /opt/competition-radar/logs/maintain-new/找新一届-$$(date +%%F-%%H%%M).json"' },
];

describe('定时器', () => {
  test.each(任务们)('$名：按北京时间 $时间 启动；错过了不补跑', ({ 名, 时间 }) => {
    const timer = 读(`${名}.timer`);
    expect(项(timer, 'OnCalendar')).toEqual([时间]);
    expect(项(timer, 'Persistent')).toEqual(['false']);
    expect(项(timer, 'Unit')).toEqual([`${名}.service`]);
  });
  test.each(任务们)('$名：服务跑的是仓库里真有的脚本，环境变量从服务器上的 env 文件读（值不进仓库）', ({ 名, 脚本, 参数 = '', 命令 }) => {
    const service = 读(`${名}.service`);
    expect(项(service, 'Type')).toEqual(['oneshot']);
    expect(项(service, 'EnvironmentFile')).toEqual(['/etc/competition-radar/env']);
    expect(项(service, 'ExecStart')).toEqual([命令 ?? `/usr/bin/env node \${BACKEND_DIR}/${脚本}${参数}`]);
    expect(fs.existsSync(path.join(BACKEND, 脚本)), 脚本).toBe(true);
  });
  test('有说明：装法、时间表、要设哪些环境变量', () => {
    const readme = 读('README.md');
    for (const 词 of ['1:00', '2:00', '9:00', '10:00', '14:00', '0:30', '每周一', '归档', '新维护', '队列', '找新一届', 'BACKEND_DIR', 'systemctl']) expect(readme).toContain(词);
  });
  // 每日补缺失 2026-11-07 用户说“把这个模块删掉”：定时器、脚本、说明都不留
  test('每日补缺失已删掉', () => {
    for (const 文件 of ['competition-radar-fill.timer', 'competition-radar-fill.service']) expect(fs.existsSync(path.join(DIR, 文件)), 文件).toBe(false);
    expect(fs.existsSync(path.join(BACKEND, '美国/db/维护/补缺失'))).toBe(false);
    expect(读('README.md')).not.toMatch(/补缺失|competition-radar-fill/);
  });
  // 2026-11-12 用户定：旧 AI 审查（Codex 核对原文）和轮流维护删掉，模板不留；README 不再写旧入口
  test('旧 AI 审查、轮流维护的定时器已删掉，没有服务再跑 维护/run.mjs', () => {
    for (const 文件 of ['competition-radar-ai-review.timer', 'competition-radar-ai-review.service', 'competition-radar-maintain.timer', 'competition-radar-maintain.service']) {
      expect(fs.existsSync(path.join(DIR, 文件)), 文件).toBe(false);
    }
    expect(fs.existsSync(path.join(BACKEND, '美国/db/维护/run.mjs'))).toBe(false);
    for (const 文件 of fs.readdirSync(DIR).filter(f => f.endsWith('.service'))) expect(读(文件), 文件).not.toContain('维护/run.mjs');
    expect(读('README.md')).not.toMatch(/维护\/run\.mjs|--批 100/);
  });
});
