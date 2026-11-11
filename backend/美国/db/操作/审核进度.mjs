// 维护进程写进度，后台进程通过同一个比赛库读。每个比赛只保留最后一次，最近最多 30 项。
import { randomUUID } from 'node:crypto';
import * as 维护队列 from './维护队列.mjs';

const 表 = 'admin_state';
const 编号 = 'ai_review_progress';
const 保留数 = 30;
const 步数 = 24;
const 读记录 = db => db.get(表, 编号)?.data.data ?? {};
const 步骤 = (阶段, 时间, 详情 = {}) => ({ 阶段, 时间, ...详情 });

function 写(db, 改) {
  db.transaction(tx => {
    const 行 = tx.get(表, 编号);
    const data = 改(行?.data.data ?? {});
    if (!data) return;
    if (行) tx.update(表, 编号, { data }, 行.version);
    else tx.insert(表, 编号, { data });
  });
}

export function 开始(db, 比赛编号, { 手动, now = () => new Date() } = {}) {
  const 本次 = randomUUID();
  const 开始时间 = now().toISOString();
  const 当前 = { 比赛编号, 来源: 手动 ? '手动' : '自动', 开始时间, 步骤们: [步骤('准备审核', 开始时间)] };
  写(db, 原 => ({ ...原, 正在: { 本次, 进程: process.pid, ...当前 } }));
  return {
    更新(阶段, 详情) {
      写(db, 原 => {
        if (原.正在?.本次 !== 本次) return null;
        const 记录 = 原.正在;
        const 新步骤 = 步骤(阶段, now().toISOString(), 详情);
        return { ...原, 正在: { ...记录, 步骤们: [...记录.步骤们, 新步骤].slice(-步数) } };
      });
    },
    结束(状态, 结果 = null) {
      写(db, 原 => {
        if (原.正在?.本次 !== 本次) return null;
        const { 本次: _本次, 进程: _进程, ...记录 } = 原.正在;
        const 归档 = { ...记录, 状态, 结束时间: now().toISOString(), 结果 };
        return { 正在: null, 最近: [归档, ...(原.最近 ?? []).filter(x => x.比赛编号 !== 比赛编号)].slice(0, 保留数) };
      });
    },
  };
}

function 还在运行(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (错误) { return 错误.code === 'EPERM'; }
}

export function 读(db, { 比赛编号, now = new Date() } = {}) {
  const 原 = 读记录(db);
  const 取名字 = id => db.get('competition', id)?.data.name;
  const { 本次: _本次, 进程, ...当前 } = 原.正在 ?? {};
  const 活动 = 当前.比赛编号 && 取名字(当前.比赛编号)
    ? { ...当前, 状态: 还在运行(进程) ? '审核中' : '审核中断' }
    : null;
  const 正在 = 活动?.状态 === '审核中' ? 活动 : null;
  const 最近 = [...(活动?.状态 === '审核中断' ? [活动] : []), ...(原.最近 ?? [])]
    .filter(x => x.比赛编号 !== 活动?.比赛编号 || x === 活动);
  const 暂停到 = 维护队列.生效暂停(db, now)?.pausedUntil ?? null;
  const 排队 = 维护队列.读(db).排队
    .filter(id => id !== 正在?.比赛编号)
    .map(比赛编号 => ({ 比赛编号, 名称: 取名字(比赛编号) }))
    .filter(比赛 => 比赛.名称)
    .map((比赛, i) => ({ ...比赛, 状态: 暂停到 ? '等待重试' : '排队中', 排位: i + 1 }));
  const 带名称 = x => ({ ...x, 名称: 取名字(x.比赛编号) ?? x.比赛编号 });
  if (比赛编号) {
    const 上次 = 最近.find(x => x.比赛编号 === 比赛编号);
    const 等待 = 排队.find(x => x.比赛编号 === 比赛编号);
    const 当前进度 = 正在?.比赛编号 === 比赛编号 ? 正在
      : 等待 ? { ...上次, ...等待 }
        : 上次 ?? { 比赛编号, 状态: '暂无审核记录' };
    return { 比赛: 带名称(当前进度), 暂停到 };
  }
  return { 正在: 正在 ? 带名称(正在) : null, 排队, 最近: 最近.map(带名称), 暂停到 };
}
