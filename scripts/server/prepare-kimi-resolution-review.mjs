import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { hasUnresolvedAiReview } = require('../../apps/miniprogram/cloudfunctions/adminData/aiReviewSchedule.js');
const snapshot = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const queue = snapshot.records.filter(record => !['archived','quarantined'].includes(record.dataStatus) && hasUnresolvedAiReview(record));
fs.mkdirSync('reports/kimi-resolution-review',{recursive:true});
for (let i=0;i<3;i++) {
  const records = queue.filter((_,index) => index%3 === i);
  const file = `reports/kimi-resolution-review/group-${i+1}.json`;
  fs.writeFileSync(file,JSON.stringify({createdAt:new Date().toISOString(),records},null,2));
  console.log(JSON.stringify({file,count:records.length,ids:records.map(record=>record.id)}));
}
