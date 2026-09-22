// 通知是发现赛事的线索。只有解析出赛事本身及独立的官方入口后才能发布。
function isNoticeTitle(value) {
  const title = String(value || '').trim();
  return /^(关于|转发|【?通知】?|赛事通知[：:])/.test(title) || /通知\s*_/.test(title) || /(?:的通知|报名通知|参赛通知|选拔通知)$/.test(title);
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
