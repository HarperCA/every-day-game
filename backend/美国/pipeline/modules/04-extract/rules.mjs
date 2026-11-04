// 抽取的判断规则：纯函数，不调接口，直接从现有代码搬过来。
// 来源：run-extract.mjs 的 yieldedNothing、page-supplement.mjs 的 missingKeyFields。

// 抽空了：主办方、权威信号、回报一项都没抽到。实测同样的输入有时抽空、再跑一次就正常，所以抽空了重试一次。
export function yieldedNothing(fields) {
  if (!fields) return true;
  return !fields.organizer && !(fields.authority_signals || []).length && !(fields.reward_highlights || []).length;
}

// 关键信息还缺哪几项：缺了就去补读正式通知。
export function missingKeyFields(fields = {}) {
  const missing = [];
  if (!fields?.participants && !fields?.eligibility) missing.push('参赛对象');
  if (!fields?.registration_end) missing.push('报名时间');
  return missing;
}

// 抽取结果里有值的关键字段数：补读后比较，多了才换用补读的结果。
export function keyFieldCount(fields = {}) {
  return ['participants', 'eligibility', 'registration_start', 'registration_end', 'organizer'].filter(name => fields?.[name]).length;
}
