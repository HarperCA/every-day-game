import fs from 'node:fs';
const {summary,rows}=JSON.parse(fs.readFileSync('.tmp/missing-fields-current.json','utf8'));
const labels={organizer:'主办方',participants:'参赛对象',eligibility:'参赛资格',formatAndRules:'赛制与规则',professions:'适合专业',sources:'来源网址',registrationStart:'报名开始',registrationEnd:'报名截止',registrationMethod:'报名方式',registrationUrl:'报名网址',fees:'费用说明',teamSize:'组队人数'};
const core=['organizer','participants','eligibility','formatAndRules','professions','sources'];
let text=`# 关键资料缺失专项检查\n\n快照时间：${summary.at}；数据版本：${summary.version}；底层记录数：${summary.total}（含隔离 ${summary.isolated} 条）。\n\n口径：统计字段为空或数组为空，不代表非空字段已经核实；日期未知、来源未公布和官方明确待公布须另行区分；记录包含重复，不等于不同比赛数量。此次只检查，不修改业务数据。\n\n## 字段缺失数量\n\n|字段|为空记录数|\n|---|---:|\n`;
for(const [key,count]of Object.entries(summary.counts))text+=`|${labels[key]}|${count}|\n`;
text+=`\n核心身份/范围字段至少一项为空：${summary.missingCore} 条。已发布记录中命中这项空字段检查：${summary.publishedMissingCore} 条。\n\n## 原因检查\n\n旧 candidateToRecord 转换器默认将 participants、eligibility、formatAndRules、teamSize、registrationMethod、fees 置空，professions 置空数组。competitionExtract 的抽取提示词只覆盖主办方、权威/回报信号、报名组织和起止日期，没有完整抽取资格、规则、费用。定时 Kimi 审核保存 aiReview，不自动补写这些业务字段。由此不能把库内缺失一概说成官方未公布。\n\n2026-09-22 重新读取 CCF 官方通知成功：面向全国高校在校生、CSP成绩门槛、机考规则、报名流程和收费标准均有正文，而库内三条对应旧记录仍有空字段。官方页面：https://ccsp.ccf.org.cn/ccsp/tzgg/2026-09-09/931080.shtml 。温州医科大学页面本次读取失败，历史AI意见仅作线索，不视为重新核实。\n\n## 35 条核心缺失记录\n\n`;
for(const [i,r] of rows.filter(r=>r.missingFields.some(f=>core.includes(f))).entries()){
 text+=`### ${i+1}. ${r.name}\n\n- 标识：\`${r.id}\`；状态：${r.dataStatus}\n- 空字段：${r.missingFields.map(f=>labels[f]).join('、')}\n- 历史审核意见（未必正确）：${r.aiReview?.summary||'无'}\n- 来源：${(r.sources||[]).map(s=>`<${s.url}>`).join('、')}\n\n`;
}
fs.writeFileSync('reports/missing-fields-audit-20260922.md',text);
console.log('Report written');
