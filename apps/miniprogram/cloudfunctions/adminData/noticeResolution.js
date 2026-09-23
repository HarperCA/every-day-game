// 通知是发现赛事的线索。只有解析出赛事本身及独立的官方入口后才能发布。
// 公众号／资讯站常把「竞赛通知丨」「赛事通知 |」当栏目标签挂在真实赛事名前面，
// 抓下来标题就变成「竞赛通知丨XX大赛」——它是一篇通知，不是赛事条目，赛事名
// 得从后半截解析出来。原先只认「赛事通知：」一种写法，实测漏掉两条：
//   「竞赛通知丨"共同关切"——2026全国大学生花园设计建造竞赛【社区花园赛道】」
//   「赛事通知 | 首届全国大学生零碳科技创新大赛哈工大青柠校园赛等你报名!」
// 分隔符各家不同：丨(U+4E28，像竖线的汉字)、｜(U+FF5C 全角)、|(半角)、：、-、—。
// 按「标签 + 分隔符」整体匹配，而不是继续往枚举里加具体写法。
const NOTICE_LABEL = /^(?:赛事|竞赛|比赛|大赛|活动)?(?:通知|公告|通告|公示|资讯)\s*[丨｜|：:·\-—]/;

function isNoticeTitle(value) {
  const title = String(value || '').trim();
  return /^(关于|转发|【?通知】?)/.test(title)
    || NOTICE_LABEL.test(title)
    || /通知\s*_/.test(title)
    || /(?:的通知|报名通知|参赛通知|选拔通知)$/.test(title);
}

function needsNoticeResolution(record = {}) {
  return isNoticeTitle(record.name) || isNoticeTitle(record.editionName) || isNonEventTitle(record.name);
}

const SECTION_TITLES = new Set(['大赛动态', '国赛公告', '通知公告', '竞赛分类:']);
function isSectionTitle(value) {
  return SECTION_TITLES.has(String(value || '').trim());
}

function isNonEventTitle(value) {
  const title = String(value || '').trim();
  return isSectionTitle(title)
    || /(?:学术资讯速递|赛事目录(?:的公示)?|学科竞赛目录清单|竞赛项目目录)/.test(title)
    || /决赛(?:在[^，。]{0,15})?(?:举行|闭幕|落幕|收官)$/.test(title);
}

module.exports = { isNoticeTitle, isSectionTitle, isNonEventTitle, needsNoticeResolution };
