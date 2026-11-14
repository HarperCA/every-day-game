import { 比赛身份, 比届次, 库中届次 } from '../../../common/届次与赛道.mjs';
import { 网址键 } from '../../../common/网址键.mjs';

function 赛事键(value) {
  return 比赛身份(value).名称键.normalize('NFKC').toLowerCase().replace(/[\p{P}\s]/gu, '');
}

function 真实赛道(届, 比赛) {
  const track = String(届.track_name || '').trim();
  const name = 比赛?.name || '';
  // 导入的旧记录会把总赛事名、默认标签或赛道清单填到 track_name。
  if (/^(?:主赛道|总赛事|主体赛事|常规赛|全部赛道|无)$/.test(track) || /[、；;]/.test(track)
      || [届.edition_name, name].some(title => title && 赛事键(track) === 赛事键(title))) {
    return { ...库中届次({ ...届, track_name: null }, name), 赛道键: '' };
  }
  return 库中届次(届, name);
}

export function 复核待入库({ 小数据库, 主库, now = new Date() }) {
  const 比赛 = new Map(主库.list('competition').map(row => [row.key, row.data]));
  const 届次 = new Map(主库.list('edition').map(row => [row.key, row.data]));
  const 来源 = new Map();
  const 记来源 = ({ edition_id, url, final_url }) => {
    const keys = 来源.get(edition_id) || new Set();
    for (const u of [url, final_url]) if (网址键(u)) keys.add(网址键(u));
    来源.set(edition_id, keys);
  };
  for (const row of 主库.list('source')) 记来源(row.data);

  const 组 = new Map();
  for (const c of 小数据库.changes()) {
    if (c.result !== '待提交' || !c.item_key || c.module !== '06-ingest' || c.tbl === 'rejected_url') continue;
    const list = 组.get(c.item_key) || [];
    list.push(c);
    组.set(c.item_key, list);
  }
  const 结果 = [];
  for (const [key, changes] of 组) {
    const item = 小数据库.item(key);
    if (item?.status !== '进行中' || !item.data?.ingest) continue;
    const { decision, competitionId, editionId } = item.data.ingest;
    const 记录 = item.data.review?.记录 || {};
    const 新届 = changes.find(c => c.tbl === 'edition' && c.op === 'insert')?.payload;
    const 新赛 = changes.find(c => c.tbl === 'competition' && c.op === 'insert')?.payload;
    const 来源们 = changes.filter(c => c.tbl === 'source' && c.op === 'insert').map(c => c.payload);
    const 名称 = 记录.name || 新届?.edition_name || item.data.name || key;
    const 赛道 = 新届?.track_name || 记录.track_name || '';
    let 原因 = '';
    if (新届) {
      const identity = 库中届次(新届, 名称);
      const keyName = 赛事键(名称);
      const 同名 = new Set([...比赛].filter(([, c]) =>
        [c.name, ...(c.aliases || [])].some(n => 赛事键(n) === keyName)).map(([id]) => id));
      const 候选网址 = new Set(来源们.flatMap(s => [网址键(s.url), 网址键(s.final_url)]).filter(Boolean));
      for (const [id, existing] of 届次) {
        const c = 比赛.get(existing.competition_id);
        const old = 真实赛道(existing, c);
        const 同网址 = [...(来源.get(id) || [])].some(u => 候选网址.has(u));
        const 同赛事 = 同名.has(existing.competition_id) || 赛事键(existing.edition_name) === keyName;
        if (同网址 && (!identity.赛道键 || !old.赛道键 || old.赛道键 === identity.赛道键)) {
          原因 = '同一来源已关联届次 ' + id + '，需核实其赛道和届次';
          break;
        }
        if (!同赛事 || identity.赛道键 !== old.赛道键) continue;
        const 次序 = 比届次(identity, old);
        if (次序 === 0 || 次序 === -1) {
          原因 = (次序 === 0 ? '正式库或本批已有同届 ' : '正式库或本批已有较新届次 ') + id;
          break;
        }
        if (新赛) {
          原因 ||= 次序 === 1 ? '应挂到已有比赛 ' + existing.competition_id : '已有同名赛事，届次证据不足 ' + existing.competition_id;
        }
      }
      if (!原因 && !来源们.length) 原因 = '缺少可复核来源';
      const 年份们 = 来源们.flatMap(s => [...String(s.evidence_excerpt || '').matchAll(/((?:19|20)\d{2})年/g)].map(m => Number(m[1])));
      const 今年 = new Date(now.getTime() + 8 * 3600000).getUTCFullYear();
      if (!原因 && 新届.status === '已发布' && !新届.registration_start && !新届.registration_end &&
          年份们.length && Math.max(...年份们) < 今年) {
        原因 = '来源只提供了往年证据，缺少当前届次或报名信息';
      }
      if (!原因) {
        if (新赛) 比赛.set(competitionId, 新赛);
        届次.set(editionId, 新届);
      }
    } else if (decision === '补来源') {
      const 已有网址 = 来源.get(editionId) || new Set();
      if (!届次.has(editionId)) 原因 = '目标届次未通过复核或已不存在';
      else if (!来源们.length || 来源们.some(s => [网址键(s.url), 网址键(s.final_url)].some(u => u && 已有网址.has(u)))) {
        原因 = '目标届次已收录该来源';
      }
    }
    if (!原因) for (const source of 来源们) 记来源(source);
    结果.push({ key, 名称, 赛道, decision, competitionId, editionId, 可入库: !原因, 原因 });
  }
  return 结果;
}
