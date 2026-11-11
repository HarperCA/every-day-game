// 爬虫脚本（crawl_script）：每个比赛一份，新维护用（2026-11-08 用户定）。只管存取和步骤格式，不做业务判断、不执行步骤。
//
// 步骤是一串动作，程序照着操控网页或无头浏览器（新维护/爬虫/执行），不在服务器上运行 AI 写的代码：
//   { 动作: '打开', 网址 }                       打开一页（http、https）
//   { 动作: '等待', 选择器 } 或 { 动作: '等待', 毫秒 }   等某个元素出现，或等一会儿（最多 15000 毫秒）
//   { 动作: '点击', 选择器 }                     点击（要浏览器）
//   { 动作: '取列表', 条目, 标题?, 链接?, 日期? }  按选择器取通知条目；标题、链接、日期是相对条目的选择器，不给就用条目里第一个链接
//   最后一步必须是取列表；最多 20 步。
//
//   动作们、校验步骤(步骤)                         格式不对报“校验不通过”
//   读(db, 比赛编号) → { 比赛, version, 列表页, 步骤, 要浏览器, 写的人, 提示版本, 上次跑通, 连续失败, 上次错误, updated_at, updated_by } 或 null
//   写(db, 比赛编号, { 列表页, 步骤, 要浏览器, 写的人, 提示版本 }, { 版本, 操作人 }) → { id, version }
//       第一次写不带版本号，之后带读到的版本号；重写后连续失败清零
//   记结果(db, 比赛编号, { 成功, 错误, 时间 }) → { id, version }    跑通记时间、失败数清零；跑不通失败数加一、记原因
import { DbError } from '../../../共用/db/index.mjs';

export const 动作们 = ['打开', '等待', '点击', '取列表'];
const 表 = 'crawl_script';
const 最多步 = 20;
const 最长等待 = 15000;

const 不通过 = (message, id = null) => new DbError('校验不通过', `爬虫脚本${message}`, { table: 表, id, problems: [{ field: 'steps', rule: '格式', message }] });
const 有字 = v => typeof v === 'string' && v.trim() !== '';

export function 校验步骤(步骤, id = null) {
  if (!Array.isArray(步骤) || !步骤.length) throw 不通过('至少一步', id);
  if (步骤.length > 最多步) throw 不通过(`最多 ${最多步} 步，现在 ${步骤.length} 步`, id);
  步骤.forEach((步, i) => {
    const 第 = `第 ${i + 1} 步`;
    if (!步 || typeof 步 !== 'object' || !动作们.includes(步.动作)) throw 不通过(`${第}是不认识的动作：${步?.动作 ?? '空'}`, id);
    if (步.动作 === '打开' && !/^https?:\/\//i.test(String(步.网址 || ''))) throw 不通过(`${第}：打开要给 http 网址`, id);
    if (步.动作 === '点击' && !有字(步.选择器)) throw 不通过(`${第}：点击要给选择器`, id);
    if (步.动作 === '等待') {
      if (!有字(步.选择器) && !Number.isInteger(步.毫秒)) throw 不通过(`${第}：等待要给选择器或毫秒`, id);
      if (Number.isInteger(步.毫秒) && (步.毫秒 < 0 || 步.毫秒 > 最长等待)) throw 不通过(`${第}：等待最多 ${最长等待} 毫秒`, id);
    }
    if (步.动作 === '取列表') {
      if (!有字(步.条目)) throw 不通过(`${第}：取列表要给条目选择器`, id);
      for (const 名 of ['标题', '链接', '日期']) if (步[名] != null && typeof 步[名] !== 'string') throw 不通过(`${第}：${名}要是选择器文字`, id);
    }
  });
  if (步骤.at(-1).动作 !== '取列表') throw 不通过('最后一步要是取列表', id);
  return 步骤;
}

export function 读(db, 比赛编号) {
  const 行 = db.get(表, 比赛编号);
  if (!行) return null;
  const d = 行.data;
  return { 比赛: 比赛编号, version: 行.version, 列表页: d.list_url, 步骤: d.steps, 要浏览器: Boolean(d.needs_browser), 写的人: d.written_by ?? null, 提示版本: d.prompt_version ?? null,
    上次跑通: d.last_ok_at ?? null, 连续失败: d.fail_count, 上次错误: d.last_error ?? null, updated_at: d.updated_at, updated_by: d.updated_by ?? null };
}

export function 写(db, 比赛编号, { 列表页, 步骤, 要浏览器 = false, 写的人 = null, 提示版本 = null } = {}, { 版本 = null, 操作人 = null } = {}) {
  校验步骤(步骤, 比赛编号);
  const 内容 = { list_url: 列表页, steps: 步骤, needs_browser: Boolean(要浏览器), written_by: 写的人, prompt_version: 提示版本, fail_count: 0, last_error: null, updated_by: 操作人 };
  return db.transaction(tx => {
    if (版本 == null) {
      if (tx.get(表, 比赛编号)) throw new DbError('请求有误', `比赛 ${比赛编号} 已有爬虫脚本，改要带读到的版本号`, { table: 表, id: 比赛编号 });
      if (!tx.get('competition', 比赛编号, { 包括已删除: true })) throw new DbError('找不到', `没有比赛 ${比赛编号}`, { table: 'competition', id: 比赛编号 });
      const 回 = tx.insert(表, 比赛编号, { ...内容, last_ok_at: null });
      return { id: 回.id, version: 回.version };
    }
    const 回 = tx.update(表, 比赛编号, 内容, 版本);
    return { id: 回.id, version: 回.version };
  });
}

export function 记结果(db, 比赛编号, { 成功, 错误 = '', 时间 = new Date().toISOString() } = {}) {
  return db.transaction(tx => {
    const 行 = tx.get(表, 比赛编号);
    if (!行) throw new DbError('找不到', `比赛 ${比赛编号} 还没有爬虫脚本`, { table: 表, id: 比赛编号 });
    const 改 = 成功 ? { last_ok_at: 时间, fail_count: 0, last_error: null } : { fail_count: (行.data.fail_count || 0) + 1, last_error: String(错误 || '跑不通').slice(0, 200) };
    const 回 = tx.update(表, 比赛编号, 改, 行.version);
    return { id: 回.id, version: 回.version };
  });
}
