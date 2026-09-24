import fs from 'node:fs';
const token = fs.readFileSync('/opt/daily-contest/.admin-token', 'utf8').trim();
const response = await fetch('http://127.0.0.1:8787/api/adminData', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ adminToken:token, action:'bootstrap' }) });
const result = await response.json();
if (!result.ok) throw new Error(result.message);
const pattern = /棋牌|象棋|围棋|桥牌|游泳|跑步|马拉松|羽毛球|足球|篮球|冰球|棒球|乒乓球|武术|摄影|短视频|书法|歌唱|舞蹈|动漫|电竞|游戏|朗诵|诗词|绘画|征文|知识竞答|科普|公益|烹饪|模型|定向|射箭|轮滑|铁人|无线电测向|体育|运动|冰壶|航空航天模型/;
const rows = result.data.records.filter(item => pattern.test(String(item.name || '')));
console.log(JSON.stringify({ total:result.data.records.length, matched:rows.length, rows:rows.map(item => ({ id:item.id, name:item.name, status:item.dataStatus, professions:item.professions, participants:item.participants, eligibility:item.eligibility, eventLevel:item.eventLevel })) }, null, 2));
