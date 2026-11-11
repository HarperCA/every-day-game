// 标题筛选：程序化筛选，只看标题，能判的不用问 Jev。给筛选总管提供筛选函数。
// 搬自 crawler/lib/jevCandidateFilter.mjs 的 deterministicCandidateDecision 和 titleHasNoInfo（规则不变）。
//
//   标题筛选(候选) → { 去向: '扔' | '追溯' | '线索', 类别, 原因 } 或 null（看不出来，交给 Jev）
//
// 校内选拔、学校转发、赛事新闻里都写着上级比赛的名字，是找新比赛最好的线索，所以去追溯，不扔（2026-09-29 用户定）。
// 明显不是大学生的（中小学、青少年、兴趣体育）用程序审核范围闸的判断，规则只有一份（2026-11-01）；
// 范围闸里通知、校赛、报道也算“不收”，但在这一步它们是追溯线索，所以只取“明显不是大学生”这一条。
import { 明显不是大学生 } from '../../../../程序审核/index.mjs';

const DIRECTORY = /(?:竞赛|赛事|项目)(?:目录|清单)|有哪些(?:学科)?竞赛|竞赛项目的公示|竞赛项目目录/;
const SCHOOL_SELECTION = /校级选拔|校内选拔|校赛|院级选拔|院内选拔/;
const RESULT_NEWS = /(?:获|荣获).{0,35}(?:奖|金牌|银牌|铜牌)|(?:一等奖|二等奖|三等奖)|决赛.{0,18}(?:举行|落幕|闭幕|收官)|(?:启动|开幕)仪式|正式启动|正式开启|正式开赛|正式拉开帷幕|火热开启|隆重开幕/;
const COLUMN = /^(?:大赛动态|国赛公告|通知公告|竞赛分类[:：]?)$|学术资讯速递/;
const ORGANIZATION_ONLY = /^(?:中国|全国|[一-龥]{2,8}省|[一-龥]{2,8}市)?[一-龥]{2,25}(?:学会|协会|学院|研究院|教育厅|教育局)$/;

// 标题只有日期、时间、地名（如微信推文的“2026年9月27日 09:54广东”）：没有信息量，只当追溯线索，用摘要里的比赛名去搜（2026-10-01 用户定）
const TIME_WORDS = /(?:19|20)\d{2}\s*[年\-/.]\s*\d{1,2}\s*[月\-/.]\s*\d{1,2}\s*日?|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}:\d{2}(?::\d{2})?|(?:周|星期)[一二三四五六日天]|[上下]午|凌晨|晚上|(?:19|20)\d{2}\s*年(?:\s*\d{1,2}\s*月)?|\d{1,2}\s*月/g;
const PLACE_WORDS = ['内蒙古', '黑龙江', '北京', '天津', '上海', '重庆', '河北', '山西', '辽宁', '吉林', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西',
  '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '宁夏', '新疆', '西藏', '香港', '澳门', '台湾', '全国'];

export function 没有信息量(title) {
  const original = String(title || '').normalize('NFKC');
  let rest = original.replace(TIME_WORDS, '');
  for (const word of PLACE_WORDS) rest = rest.split(word).join('');
  rest = rest.replace(/[一-龥]{1,4}[省市区县]/g, '');
  // 至少要真的去掉了日期、时间或地名才算（单个字之类的标题不归这条规则管）
  if (rest === original) return false;
  return rest.replace(/[\s\p{P}\p{S}\d]/gu, '').length <= 1;
}

export function 标题筛选(候选) {
  const title = String(候选.data?.name || '').normalize('NFKC').trim();
  if (!title) return { 去向: '扔', 类别: 'column_other', 原因: '标题为空' };
  if (明显不是大学生({ name: title })) return { 去向: '扔', 类别: 'unrelated', 原因: '非大学生专业赛事（中小学、青少年或兴趣体育，程序审核·范围闸）' };
  if (没有信息量(title)) return { 去向: '追溯', 类别: 'title_no_info', 原因: '标题只有日期、时间或地名，没有信息量：不读详情，用摘要里的比赛名去追溯' };
  if (SCHOOL_SELECTION.test(title)) return { 去向: '追溯', 类别: 'repost_or_school_selection', 原因: '校级或校内选拔：不入库，追溯上级比赛的官网和官方通知' };
  if (DIRECTORY.test(title)) return { 去向: '线索', 类别: 'directory_lead', 原因: '只留线索：竞赛目录或清单' };
  if (RESULT_NEWS.test(title)) return { 去向: '追溯', 类别: 'news_or_result', 原因: '赛事报道：不入库，追溯比赛的官网和当届官方通知' };
  if (COLUMN.test(title)) return { 去向: '线索', 类别: 'column_lead', 原因: '只留线索：栏目页，不是具体比赛' };
  if (ORGANIZATION_ONLY.test(title) && !/大赛|竞赛|比赛|挑战赛/.test(title)) return { 去向: '线索', 类别: 'organization_lead', 原因: '只留线索：机构名称，不是具体比赛' };
  return null;
}
