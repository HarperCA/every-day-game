import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action:'bootstrap' }) });
const result = await response.json();
if (!result.ok) throw new Error(result.message);
const patterns = [/^大赛动态$/, /^国赛公告$/, /^通知公告$/, /^前沿之声\|5月学术资讯速递$/, /^竞赛分类[:：]$/, /全省普通高校本专科生学科竞赛省级赛事目录的公示/, /河南工程学院A、B、C类学科竞赛目录清单/, /附件 福建省2026年大学生学科专业竞赛项目目录/, /AI赋能千行百业超级联赛人工智能\+广电视听创新应用大赛决赛在京举行/];
const rows = result.data.records.filter(item => patterns.some(pattern => pattern.test(String(item.name || '').trim())));
console.log(JSON.stringify({ total:result.data.records.length, matched:rows.length, rows:rows.map(item => ({ id:item.id, name:item.name, status:item.dataStatus, url:item.registrationUrl, sourceType:item.sources?.[0]?.source_type, sourceOfficial:item.sources?.[0]?.is_official, sourceValidity:item.sources?.[0]?.validity_status, firstSeenAt:item.firstSeenAt, updatedBy:item.updatedBy, qualityIssueCount:item.qualityIssues?.length, aiReview:item.aiReview ? { decision:item.aiReview.decision, summary:item.aiReview.summary } : null })) }, null, 2));
