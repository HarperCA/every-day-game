// 赛事名称只保留赛事本体。年份、届次是当届属性，不进入 name。
// editionName 保留主办方原始届次表述，供审计与核验；它不作为前台标题显示。
const YEAR = /(?<!\d)((?:19|20)\d{2}(?:\s*[-—–~～至]\s*(?:19|20)\d{2})?)(?:年(?:度)?|赛季)?(?!\d)/g;
const ORDINAL = /第[零〇一二三四五六七八九十百千万两\d]+届/g;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeYear(value) {
  return String(value || '').replace(/\s*[-–~～至]\s*/g, '—');
}

function extractMetadata(value) {
  const text = String(value || '');
  return {
    years:unique([...text.matchAll(YEAR)].map(match => normalizeYear(match[1]))),
    ordinals:unique([...text.matchAll(ORDINAL)].map(match => match[0])),
  };
}

function stripEditionTokens(value) {
  let title = String(value || '');
  title = title.replace(YEAR, '').replace(ORDINAL, '');
  title = title.replace(/\(\s*\)|（\s*）|【\s*】|\[\s*\]/g, '');
  title = title.replace(/\s{2,}/g, ' ')
    .replace(/^[\s,，、:：|｜丨·•\-—–]+|[\s,，、:：|｜丨·•\-—–]+$/g, '')
    .trim();
  return title;
}

function normalizeEditionTitle(record = {}) {
  const originalName = String(record.name || '').trim();
  const originalEditionName = String(record.editionName || '').trim();
  const nameMeta = extractMetadata(originalName);
  const editionMeta = extractMetadata(originalEditionName);
  const years = unique([...nameMeta.years, ...editionMeta.years]);
  const ordinals = unique([...nameMeta.ordinals, ...editionMeta.ordinals]);
  const stripped = stripEditionTokens(originalName);
  const issues = [];
  if (!stripped) issues.push('名称去除年份届次后为空');
  if (years.length > 1 && !years.some(year => year.includes('—'))) issues.push('发现多个不同年份，需核对当届');
  if (ordinals.length > 1) issues.push('标题涉及多个届次，需核对各自对应赛事');
  return {
    name:stripped || originalName,
    editionYear:String(record.editionYear || years.find(year => year.includes('—')) || years[0] || ''),
    editionOrdinal:String(record.editionOrdinal || ordinals.join('、')),
    issues,
  };
}

function titleHasEditionTokens(value) {
  return extractMetadata(value).years.length > 0 || extractMetadata(value).ordinals.length > 0;
}

module.exports = { extractMetadata, stripEditionTokens, normalizeEditionTitle, titleHasEditionTokens };
