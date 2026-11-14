// 高校转发的记录整理（2026-11-12 用户定，找新一届用）：追不到官方通知的新一届用高校转发的通知建，学校自己的内容不能当成全国的。
//   主办方：按 、，；空格 拆开，去掉学校和学校部门（“××大学”“××学院”结尾的、“××大学教务处/团委/……”、我校、本校）；去光了就留空
//     （届次主办方空着时显示比赛的；不拿上一届的顶上——没核到的不写）。
//   参赛对象、参赛资格、报名方式、赛制和规则：写着“我校”“本校”“全校”“我院”“校内”“校赛”这类学校内部说法的，留空。
//   报名时间：原文出处（04 抽取的 quote）写的是交给学院、学校的截止（交至、报送、学院、教务处、团委……），或者根本没有出处的，
//     不当全国报名截止——报名开始、截止都留空，pending_announcement 为真（时间以官方通知为准）。出处里是全国的截止（如“大赛报名截止时间为…”）照用。
//   报名网址：和转发页同一个网站的（没单独抽到时就是转发页本身）不当报名入口，留空；别的网站的照用。
//
//   高校转发整理(记录, { fields, 通知网址 }) → { 记录, 说明: [文字] }   fields：04 抽取的 extraction.fields（{ 字段: { value, quote } }）
const 学校内部 = /我校|本校|全校|我院|本院|校内|校级|校赛|院赛|院级|校团委|教务处|学生处|研究生院|二级学院|各学院/;
const 学校单位 = /(大学|学院|学校)$|(大学|学院|学校)\S*(处|部|办|办公室|中心|团委|委员会办公室)$|我校|本校|教务处|校团委/;
// 交给学校、学院的截止（不是全国报名截止）
const 学校截止 = /学院|我校|本校|校内|校团委|教务处|学生处|团委|(交|报|送|提交|发送|报送|上报)(至|到|给)|汇总|联系人|办公室|邮箱/;
const 文字字段 = ['participants', 'eligibility', 'registration_method', 'format_and_rules'];
const 主机 = 网址 => { try { return new URL(网址).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const 有值 = v => typeof v === 'string' ? Boolean(v.trim()) : v !== null && v !== undefined;

export function 高校转发整理(记录, { fields = {}, 通知网址 = '' } = {}) {
  const 新 = { ...记录 };
  const 说明 = [];
  if (有值(新.organizer)) {
    const 段们 = String(新.organizer).split(/[、，,；;\s]+/).map(x => x.trim()).filter(Boolean);
    const 留 = 段们.filter(段 => !学校单位.test(段));
    if (留.length < 段们.length) {
      新.organizer = 留.length ? 留.join('、') : null;
      说明.push(`主办方去掉学校：${段们.filter(段 => 学校单位.test(段)).join('、')}`);
    }
  }
  for (const 字段 of 文字字段) {
    if (有值(新[字段]) && 学校内部.test(String(新[字段]))) { 说明.push(`${字段} 是学校内部的说法，留空`); 新[字段] = null; }
  }
  const 是学校截止 = 字段 => {
    if (!有值(新[字段])) return false;
    const 出处 = String(fields?.[字段]?.quote || '');
    return !出处.trim() || 学校截止.test(出处);
  };
  if (['registration_start', 'registration_end'].some(是学校截止)) {
    说明.push(`报名时间是学校的截止或没有出处（${['registration_start', 'registration_end'].map(f => fields?.[f]?.quote).filter(Boolean).join(' / ') || '没有出处'}），以官方通知为准`);
    新.registration_start = null;
    新.registration_end = null;
    新.pending_announcement = true;
  }
  if (有值(新.registration_url) && 主机(新.registration_url) && 主机(新.registration_url) === 主机(通知网址)) {
    说明.push('报名网址是转发页的网站，不当报名入口');
    新.registration_url = null;
  }
  return { 记录: 新, 说明 };
}
