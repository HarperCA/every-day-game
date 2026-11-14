// 搬旧数据 · 补差量（2026-11-05）。第一次搬完后上海还在写，北京也可能被开发版写过，所以不能清空重搬。
// 拿“上次搬时的导出（基线）”和“现在的导出”比，只动上海真正变过的：
//   上海新增：北京没有就写；openid 或 同一人同一比赛的收藏 北京已有的不写，记下
//   上海改过：北京没动过就更新；北京也改过，更新时间晚的赢，记下；北京已删的不复活，记下
//   上海删了：北京没动过就跟着删（账号连带删它名下的）；北京改过的留下，记下
//   上海没变：不管北京是什么样都不动
// 报错只补基线之后的；统计按“上海增加了多少”加到北京现有的数上。副数据库一个事务写完，写完逐条核对。
// 报告里只有表名、编号、原因和条数，不带 openid 和用户写的内容。
import { 转换, 表们 } from './转换.mjs';
import { TABLES } from '../副数据库/index.mjs';

const 比较值 = 值 => JSON.stringify(值 ?? null);
// a 里有的字段 c 都一样，就算没变（c 可能多带数据库补的默认值）
const 没变 = (a, c) => Object.keys(a).every(字段 => 比较值(a[字段]) === 比较值(c[字段]));
const 主键值 = (表, 行) => 行[TABLES[表].主键];
const 按主键 = (表, 行们) => new Map(行们.map(行 => [主键值(表, 行), 行]));
const 账号字段 = () => 'user_id';

function 排差量(基线新, 现在新, 用户库) {
  const 操作们 = [];
  const 冲突们 = [];
  const 记 = (表, 编号, 原因) => 冲突们.push({ 表, 编号, 原因 });
  const 新账号们 = new Set();
  const 要删账号们 = new Set();

  for (const 表 of 表们) {
    const 基线行们 = 按主键(表, 基线新[表]);
    const 现在行们 = 按主键(表, 现在新[表]);
    for (const [编号, b] of 现在行们) {
      const a = 基线行们.get(编号);
      const c = 用户库.get(表, 编号)?.data ?? null;
      if (表 !== 'user_account' && !新账号们.has(b[账号字段(表)]) && !用户库.get('user_account', b[账号字段(表)])) {
        if (!a || !没变(a, b)) 记(表, 编号, `账号 ${b[账号字段(表)]} 在北京不存在，不写`);
        continue;
      }
      if (!a) {
        if (!c) {
          if (表 === 'user_account' && 用户库.find('user_account', { openid: b.openid }).length) { 记(表, 编号, '这个微信账号在北京已有另一个编号，不写'); continue; }
          if (表 === 'favorite' && 用户库.find('favorite', { user_id: b.user_id, competition_id: b.competition_id }).length) { 记(表, 编号, '同一人同一比赛北京已有收藏，不写'); continue; }
          if (表 === 'user_account') 新账号们.add(编号);
          操作们.push({ 动作: '新增', 表, 编号, 行: b });
        } else if (!没变(b, c)) {
          if (String(b.updated_at ?? '') > String(c.updated_at ?? '')) 操作们.push({ 动作: '修改', 表, 编号, 行: b });
          else 记(表, 编号, '基线没有、两边都有且不同，北京的更新，留北京的');
        }
        continue;
      }
      if (没变(a, b)) continue;                         // 上海没变，北京什么样都不动
      if (!c) { 记(表, 编号, '上海改过，但北京已删除，不复活'); continue; }
      if (没变(b, c)) continue;                         // 已经一样
      if (没变(a, c)) { 操作们.push({ 动作: '修改', 表, 编号, 行: b }); continue; }
      if (String(b.updated_at ?? '') > String(c.updated_at ?? '')) {
        操作们.push({ 动作: '修改', 表, 编号, 行: b });
        记(表, 编号, '两边都改过，上海的更新，用上海的');
      } else 记(表, 编号, '两边都改过，北京的更新，留北京的');
    }
    for (const [编号, a] of 基线行们) {
      if (现在行们.has(编号)) continue;
      const c = 用户库.get(表, 编号)?.data ?? null;
      if (!c) continue;
      if (!没变(a, c)) { 记(表, 编号, '上海删了，但北京改过，留下'); continue; }
      if (表 === 'user_account') 要删账号们.add(编号);
      操作们.push({ 动作: '删除', 表, 编号 });
    }
  }
  // 要注销的账号名下的新写入没有意义；账号连带删时一并处理
  return {
    操作们: 操作们.filter(操作 => !(操作.表 !== 'user_account' && 操作.动作 !== '删除' && 要删账号们.has(操作.行?.[账号字段(操作.表)]))),
    冲突们,
  };
}

function 排报错(基线, 现在, 报错库) {
  const 基线编号们 = new Set((基线.client_issues || []).map(x => String(x._id)));
  const 新的 = (现在.client_issues || []).filter(x => !基线编号们.has(String(x._id)));
  const 指纹 = x => JSON.stringify([x.kind, x.at, x.client_id ?? null, x.page ?? null, x.message ?? null]);
  const 已有 = new Set(报错库.全部().map(指纹));
  const { 报错: { issues } } = 转换({ client_issues: 新的 });
  const 基线统计 = new Map((基线.client_stats || []).map(x => [x.date ?? x._id, x]));
  const 北京统计 = new Map(报错库.全部统计().map(x => [x.date, x]));
  const 统计们 = [];
  for (const s of 现在.client_stats || []) {
    const 日期 = s.date ?? s._id;
    const 旧 = 基线统计.get(日期) || {};
    const 增 = { list: (Number(s.list) || 0) - (Number(旧.list) || 0), get: (Number(s.get) || 0) - (Number(旧.get) || 0) };
    if (增.list <= 0 && 增.get <= 0) continue;
    const 北京 = 北京统计.get(日期) || { list: 0, get: 0 };
    统计们.push({ 日期, list: 北京.list + Math.max(增.list, 0), get: 北京.get + Math.max(增.get, 0) });
  }
  return { 报错们: issues.filter(x => !已有.has(指纹(x))), 统计们 };
}

export function 补差量(基线, 现在, { 用户库, 报错库, 届次对照, 试跑 = false }) {
  const 基线转换 = 转换(基线, { 届次对照 });
  const 现在转换 = 转换(现在, { 届次对照 });
  const { 操作们, 冲突们 } = 排差量(基线转换.新, 现在转换.新, 用户库);
  const { 报错们, 统计们 } = 排报错(基线, 现在, 报错库);
  const 数 = 动作 => 操作们.filter(x => x.动作 === 动作).length;
  const 结果 = {
    统计: { 新增: 数('新增'), 修改: 数('修改'), 删除: 数('删除'), 报错: 报错们.length, 统计: 统计们.length },
    明细: 操作们.map(({ 动作, 表, 编号 }) => ({ 动作, 表, 编号 })),
    冲突们,
    问题们: 现在转换.问题们,
    上海提醒编号: (现在.reminder || []).map(x => String(x._id ?? x.id)),
    试跑,
  };
  if (试跑) return { ...结果, 核对通过: null, 核对问题们: [] };

  用户库.transaction(tx => {
    // 先删收藏、提醒这些下级，再动账号；账号连带删掉它名下剩下的（注销）
    for (const 操作 of 操作们.filter(x => x.动作 === '删除' && x.表 !== 'user_account')) tx.remove(操作.表, 操作.编号);
    for (const 操作 of 操作们.filter(x => x.动作 === '删除' && x.表 === 'user_account')) tx.彻底删除('user_account', 操作.编号);
    for (const 表 of 表们) {
      for (const 操作 of 操作们.filter(x => x.表 === 表)) {
        if (操作.动作 === '新增') tx.insert(表, 操作.编号, 操作.行);
        if (操作.动作 !== '修改') continue;
        // update 会把 updated_at 改成当前时间，上海的时间就丢了（之后比新旧会错），所以删了重写；账号有下级指向它，只能 update
        if (表 === 'user_account') tx.update(表, 操作.编号, 操作.行);
        else { tx.remove(表, 操作.编号); tx.insert(表, 操作.编号, 操作.行); }
      }
    }
  });
  if (报错们.length) 报错库.收下(报错们);
  for (const s of 统计们) 报错库.写统计(s.日期, s.list, s.get);

  const 核对问题们 = [];
  for (const 操作 of 操作们) {
    const c = 用户库.get(操作.表, 操作.编号)?.data ?? null;
    if (操作.动作 === '删除' && c) 核对问题们.push(`${操作.表} ${操作.编号} 应该删掉但还在`);
    const 要写的 = 操作.表 === 'user_account' && 操作.动作 === '修改' ? { ...操作.行, updated_at: c?.updated_at } : 操作.行;
    if (操作.动作 !== '删除' && (!c || !没变(要写的, c))) 核对问题们.push(`${操作.表} ${操作.编号} 写进去的和要写的不一样`);
  }
  return { ...结果, 核对通过: 核对问题们.length === 0, 核对问题们 };
}
