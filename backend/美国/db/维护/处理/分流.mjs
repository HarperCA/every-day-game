// 分流：每个问题该怎么处理。纯判断，不读库、不调接口。
//
//   错误，给了建议改动，有把握          → 改正（机器直接改）
//   错误，给了建议改动，但不确定        → 人工（标在届次上，等人看）
//   缺失；或者错误但不知道正确值        → 查找（调工具去查）
//
// 查找之后再分一次：
//   找到了，有把握，而且带原文出处      → 改正
//   找到了，但不确定或没有出处          → 人工
//   没找到                              → 留着，不改也不标人工，下一次审计还会再发现、再查
//
// 问题自己写明处置的照办（AI 审查，审计/核对原文）：人工、回收站、只记下（留着，只进后台记录）
// 缺失但已经带了有把握、有原文出处的改动：改正，不用再查
export function routeProblem(problem) {
  if (problem.处置) return problem.处置 === '只记下' ? '留着' : problem.处置;
  const hasFix = problem.建议改动 && Object.keys(problem.建议改动).length > 0;
  const hasSource = Array.isArray(problem.出处) && problem.出处.some(s => s?.网址 && s?.原文);
  if (problem.类型 === '缺失' && hasFix && hasSource && problem.把握 === '有把握') return '改正';
  if (problem.类型 === '错误' && hasFix) return problem.把握 === '有把握' ? '改正' : '人工';
  return '查找';
}

export function routeFound(found) {
  if (!found?.找到) return '留着';
  const hasFix = found.改动 && Object.keys(found.改动).length > 0;
  const hasSource = Array.isArray(found.出处) && found.出处.some(s => s?.网址 && s?.原文);
  return found.把握 === '有把握' && hasFix && hasSource ? '改正' : '人工';
}
