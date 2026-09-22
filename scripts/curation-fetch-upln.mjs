import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const dir = 'reports/curation-200-20260921/upln';
fs.mkdirSync(dir,{recursive:true});
const list = [...JSON.parse(fs.readFileSync('.tmp/upln-matches.json')).result.records, ...JSON.parse(fs.readFileSync('.tmp/upln-upcoming.json')).result.records];
for (const item of list) {
  const file = `${dir}/${item.id}.json`;
  if (fs.existsSync(file)) continue;
  const url = `https://cxcy.upln.cn/provincial/match/competition/detail?id=${item.id}`;
  try {
    const json = JSON.parse(execFileSync('curl.exe',['-fLs','--max-time','25',url],{encoding:'utf8',maxBuffer:4e6}));
    if(!json.success) throw Error(json.message);
    fs.writeFileSync(file,JSON.stringify({verifiedAt:new Date().toISOString(),sourceUrl:url,...json.result},null,2));
    console.log(item.name, JSON.stringify({host:json.result.host,detailChars:json.result.detail?.length,attachments:json.result.fileList?.map(x=>x.name)}));
  } catch(error) { console.log('FAILED',item.name,error.message); }
  await new Promise(resolve=>setTimeout(resolve,300));
}
