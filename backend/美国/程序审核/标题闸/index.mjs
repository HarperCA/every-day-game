// 第 1 关 标题闸：看名称、届次名称，通知、报道这类标题不是比赛条目。只看字段，不调接口。
// 搬自 adminData/noticeResolution.js（规则不变）。注意：这里判“不收”的通知、报道，在 03 筛选那一步是要追溯的线索，
// 不是扔掉（旧 search-baidu.mjs 的注释：在源头砍掉通知会把追溯这条线索通道一起砍断）；所以 03 只取这里的判断，怎么处置它自己定。
//
//   查标题(记录) → { 结果: '通过' | '不收', 原因 }      看 name、edition_name
//   是通知标题(标题)、不是比赛的标题(标题)、要追溯通知(记录)   给别处用的判断

// 公众号、资讯站常把“竞赛通知丨”当栏目标签挂在真实赛事名前面；分隔符各家不同：丨（像竖线的汉字）、｜、|、：、-、—
const 通知标签 = /^(?:赛事|竞赛|比赛|大赛|活动)?(?:通知|公告|通告|公示|资讯)\s*[丨｜|：:·\-—]/;
const 报道用语 = /正式启动|正式开启|正式开赛|启动仪式|开幕仪式|正式拉开帷幕|火热开启|隆重开幕/;
const 栏目 = new Set(['大赛动态', '国赛公告', '通知公告', '竞赛分类:']);

// 入库硬规则：名称或届次名称只要含“通知”，就只能作为发现线索。故意不判断语境
export const 含通知 = value => String(value || '').normalize('NFKC').includes('通知');

function 不收的原因(value) {
  const title = String(value || '').normalize('NFKC');
  if (含通知(title)) return '名称含“通知”，只能作为线索，不得入赛事库';
  if (title.includes('!')) return '名称含感叹号，疑似宣传或报道标题，不得入赛事库';
  if (报道用语.test(title)) return '名称含“正式启动”等活动报道用语，不得入赛事库';
  return '';
}

export function 是通知标题(value) {
  const title = String(value || '').trim();
  return 含通知(title) || /^(关于|转发|【?通知】?)/.test(title) || 通知标签.test(title) || /通知\s*_/.test(title)
    || /(?:的通知|报名通知|参赛通知|选拔通知)$/.test(title);
}

export function 不是比赛的标题(value) {
  const title = String(value || '').trim();
  return 栏目.has(title) || /(?:学术资讯速递|赛事目录(?:的公示)?|学科竞赛目录清单|竞赛项目目录)/.test(title)
    || /决赛(?:在[^，。]{0,15})?(?:举行|闭幕|落幕|收官)$/.test(title);
}

export const 要追溯通知 = (记录 = {}) => 是通知标题(记录.name) || 是通知标题(记录.edition_name) || 不是比赛的标题(记录.name);

export function 查标题(记录 = {}) {
  const 原因 = 不收的原因(记录.name) || 不收的原因(记录.edition_name);
  return 原因 ? { 结果: '不收', 原因 } : { 结果: '通过', 原因: '' };
}
