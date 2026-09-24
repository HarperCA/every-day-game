import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {assessIntakeRecord}=require('../apps/miniprogram/cloudfunctions/adminData/competitionScope.js');
const state=JSON.parse(fs.readFileSync('.tmp/disputed-current.json','utf8'));
const rows=state.records.filter(r=>r.dataStatus==='quarantined'||assessIntakeRecord(r).decision!=='eligible');
const counts={total:state.records.length,flagged:rows.length,isolated:rows.filter(r=>r.dataStatus==='quarantined').length,scopeRejected:rows.filter(r=>r.dataStatus!=='quarantined'&&assessIntakeRecord(r).decision==='reject').length,pending:rows.filter(r=>r.dataStatus!=='quarantined'&&assessIntakeRecord(r).decision==='pending').length};
const escape=s=>String(s||'').replace(/\r?\n/g,' ');
let text=`# 剩余比赛库待核问题逐条清单\n\n数据版本：${state.stateVersions.records}；生成日期：2026-09-22；总记录 ${counts.total} 条，其中规则未通过或隔离 ${counts.flagged} 条。\n\n## 口径\n\n这是现存字段与历史审核意见的盘点，不是本次重新访问官网后的事实结论。AI 审核意见可能错误；“未读到”不等于“不存在”；字段检查通过也不代表已核验合格。不同记录即使同名也逐条保留，不能把记录数当成不同比赛数。\n\n${JSON.stringify(counts)}\n\n`;
rows.forEach((r,i)=>{
 const check=assessIntakeRecord(r);
 text+=`## ${i+1}. ${escape(r.name)}\n\n- 记录标识：\`${r.id}\`\n- 数据状态：${r.dataStatus}\n- 现有规则结果：${check.decision}；${escape(check.reason)}\n- 当前隔离原因：${escape(r.quarantine?.reason)||'无'}\n- 历史 AI 审核时间：${r.aiReview?.reviewed_at||'无'}\n- 历史 AI 意见（非本次核实结论）：${escape(r.aiReview?.summary)||'无可用意见'}\n- 库内参赛对象：${escape(r.participants)||'未填'}\n- 库内资格：${escape(r.eligibility)||'未填'}\n- 库内专业分类：${(r.professions||[]).join('、')||'未填'}\n`;
 for(const source of r.sources||[])text+=`- 来源：<${source.url}>\n`;
 text+='\n';
});
fs.writeFileSync('reports/disputed-records-20260922.md',text);
console.log(JSON.stringify(counts));
const groups=new Map();for(const r of rows){const n=r.name;groups.set(n,(groups.get(n)||0)+1);}console.log(JSON.stringify([...groups].filter(x=>x[1]>1)));
