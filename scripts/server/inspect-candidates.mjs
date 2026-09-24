import fs from 'node:fs';
for(const f of ['reports/baidu-search-candidates.json','tianchi-candidates.json','tianchi-candidates-extracted.json']){
 const p='/opt/daily-contest/'+f; const d=JSON.parse(fs.readFileSync(p,'utf8')); const a=Array.isArray(d)?d:(d.candidates||d.items||[]);
 console.log(f,a.length); console.log(a.slice(0,3).map(x=>({name:x.name||x.title,source:x.sourceUrl||x.detailUrl||x.url,start:x.registration_start||x.start,end:x.registration_end||x.end,reg:x.registrationUrl||x.registration_url})));
 if(f==='tianchi-candidates.json') for(const x of a) console.log((x.name||x.title)+' | '+(x.detailUrl||x.url)+' | '+(x.registration_start||x.start)+' | '+(x.registration_end||x.end));
}
