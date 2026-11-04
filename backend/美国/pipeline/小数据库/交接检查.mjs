// 交接检查：写进小数据库之前，结果先按这里的格式检查（库.mjs 的 写入结果 调用），不合格一条都不写，这个模块算失败。
//
// 结果的格式（模块交回给总控写、或者自己调 ctx.小数据库.写入结果 写，都是这个格式）：
//   {
//     items:    [{ key, kind, status, data, result?, reason? }]   // 这一步处理过的条目（新建的或改了状态的）
//     changes:  [{ table, key, op, payload, baseVersion?, itemKey? }]  // 想写进总库的改动，最后统一提交
//     problems: ['模块级的问题，比如额度用完'],
//   }
// 没出现在 items 里的条目保持原样，留给后面的模块。
// 线索：不往下走，只留作线索（03 筛选的目录、栏目页、追不到官方来源的通知等），2026-10-31 用户定
export const ITEM_STATUSES = ['进行中', '已丢弃', '线索', '顺延', '失败'];
export const CHANGE_OPS = ['insert', 'update'];

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function checkModuleOutput(output, { module, knownKey = () => false } = {}) {
  const errors = [];
  const where = `模块 ${module} 交回的结果`;
  if (!isPlainObject(output)) throw new Error(`${where}不是一个对象`);
  const items = output.items ?? [];
  const changes = output.changes ?? [];
  const problems = output.problems ?? [];
  if (!Array.isArray(items)) errors.push('items 必须是数组');
  if (!Array.isArray(changes)) errors.push('changes 必须是数组');
  if (!Array.isArray(problems) || problems.some(p => typeof p !== 'string')) errors.push('problems 必须是文字数组');
  const keys = new Set();
  if (Array.isArray(items)) items.forEach((item, i) => {
    const at = `items[${i}]`;
    if (!isPlainObject(item)) return errors.push(`${at} 不是对象`);
    if (typeof item.key !== 'string' || !item.key.trim() || item.key.length > 300) errors.push(`${at}.key 必须是 1~300 字的文字`);
    else if (keys.has(item.key)) errors.push(`${at}.key「${item.key}」重复`);
    else keys.add(item.key);
    if (typeof item.kind !== 'string' || !item.kind.trim()) errors.push(`${at}.kind 不能为空`);
    if (!ITEM_STATUSES.includes(item.status)) errors.push(`${at}.status「${item.status}」不是 ${ITEM_STATUSES.join('/')} 之一`);
    if (!isPlainObject(item.data)) errors.push(`${at}.data 必须是对象`);
    for (const field of ['result', 'reason']) if (item[field] !== undefined && typeof item[field] !== 'string') errors.push(`${at}.${field} 必须是文字`);
  });
  if (Array.isArray(changes)) changes.forEach((c, i) => {
    const at = `changes[${i}]`;
    if (!isPlainObject(c)) return errors.push(`${at} 不是对象`);
    if (typeof c.table !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(c.table)) errors.push(`${at}.table「${c.table}」不是合法的表名`);
    if (typeof c.key !== 'string' || !c.key) errors.push(`${at}.key 不能为空`);
    if (!CHANGE_OPS.includes(c.op)) errors.push(`${at}.op 只能是 ${CHANGE_OPS.join('/')}`);
    if (!isPlainObject(c.payload)) errors.push(`${at}.payload 必须是对象`);
    if (c.op === 'update' && !Number.isInteger(c.baseVersion)) errors.push(`${at} 是修改，必须带读取时的版本号 baseVersion`);
    if (c.itemKey !== undefined && !keys.has(c.itemKey) && !knownKey(c.itemKey)) errors.push(`${at}.itemKey「${c.itemKey}」找不到对应条目`);
  });
  if (errors.length) throw new Error(`${where}格式不对：${errors.slice(0, 8).join('；')}${errors.length > 8 ? `……共 ${errors.length} 处` : ''}`);
  return { items, changes, problems };
}

export function summarize(output) {
  const byStatus = {};
  for (const item of output.items) byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  return { items: output.items.length, byStatus, changes: output.changes.length, problems: output.problems };
}
