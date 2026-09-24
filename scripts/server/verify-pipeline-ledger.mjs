import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const adminToken = fs.readFileSync(path.join(here,'.admin-token'),'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', {
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({adminToken,action:'listPipelineRuns'}),
});
const result = await response.json();
if (!result.ok) throw new Error(result.message || 'listPipelineRuns failed');
console.log(JSON.stringify({total:result.data.runs.length,
  latest:result.data.runs[0] && {id:result.data.runs[0].id,
    found:result.data.runs[0].searchResults,new:result.data.runs[0].qualifiedNew,
    published:result.data.runs[0].publishedNew,jevCost:result.data.runs[0].costsUsd.jev}},null,2));
