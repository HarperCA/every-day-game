import { getPublishBlockers } from './adminWorkflow';

export type EvidenceState = '已证实' | '官方未公布' | '待核验' | '有冲突';
export interface DraftCheck { code:string; label:string; state:EvidenceState; detail:string }
export interface DraftTaskPreview {
  eventId:string; editionId:string; editionName:string;
  result:string; checks:DraftCheck[]; blockers:string[];
  nextAction:string; targetUrl:string | null;
  lastCheckedAt:string | null; pageChanged:'未知'; nextCheckAt:null; attempts:null;
  evidenceUrls:string[]; terminal:boolean;
}

const url = (value:unknown):value is string => typeof value === 'string' && /^https?:\/\//i.test(value);
const texts = (record:any) => (Array.isArray(record.qualityIssues) ? record.qualityIssues : []).map(String).join('；');
const checked = (code:string,label:string,state:EvidenceState,detail:string):DraftCheck => ({code,label,state,detail});

export function previewDraftTask(record:any, now = new Date()):DraftTaskPreview {
  const issues = texts(record);
  const allSources = Array.isArray(record.sources) ? record.sources : [];
  const official = allSources.filter((source:any) => source.is_official && source.validity_status === 'valid'
    && !['discovery_notice','university_notice','search_candidate','competition_directory'].includes(source.source_type) && url(source.url));
  const sourceUrls = allSources.map((source:any)=>source.url).filter(url);
  const evidenceUrls = Array.from(new Set([...official.map((source:any)=>source.url),...sourceUrls])).slice(0,6) as string[];
  const targetUrl = evidenceUrls[0] || (url(record.websiteUrl) ? record.websiteUrl : null);
  const end = Date.parse(record.schedule?.registration_end || '');
  const expired = Number.isFinite(end) && end < now.getTime();
  const school = /校级选拔赛|校内选拔|校内推荐赛|学院选拔赛|校赛|院赛/.test(`${record.name || ''} ${issues}`);
  const invalidTitle = /通知|目录|清单|公告|公示|获奖|喜报|大赛动态|赛事指南|正式启动|[!！]/.test(record.name || '');
  const directory = /目录线索|目录为立项|目录文件不能充当报名入口|仅有.*目录|赛事目录/.test(issues)
    || allSources.some((source:any)=>source.source_type === 'competition_directory');
  const identityConflict = invalidTitle || school;
  const checks:DraftCheck[] = [];
  checks.push(checked('EVENT_IDENTITY','独立赛事身份', identityConflict ? '有冲突' : directory ? '待核验' : '已证实',
    identityConflict ? (school ? '记录涉及校内选拔或校内推荐，须核对上级赛事' : '标题呈现通知、目录、报道或宣传语')
      : directory ? '目前主要依据是目录，须追到当届赛事本体' : '标题未命中已知非赛事或下级选拔特征；仍以来源核验为准'));
  checks.push(checked('ORGANIZER','主办方', !String(record.organizer || '').trim() ? '待核验' : /主办方待确认|主办单位.*未写明/.test(issues) ? '待核验' : '已证实',
    record.organizer || '尚未录入主办方'));
  const audience = `${record.participants || ''} ${record.eligibility || ''}`;
  const college = /大学生|本科|专科|研究生|硕士|博士|高职|高校|高等(?:学校|院校)|在校生|在读生/i.test(audience);
  checks.push(checked('COLLEGE_ELIGIBILITY','大学生参赛资格', !audience.trim() ? '待核验' : college ? '已证实' : '有冲突',
    !audience.trim() ? '没有参赛对象及资格依据' : college ? '已有参赛资格字段，须与正式来源对应' : '现有资格字段不能确认大学生可以参赛'));
  checks.push(checked('PROFESSIONAL_SCOPE','专业任务与分类', !String(record.formatAndRules || '').trim() || !record.professions?.length ? '待核验' : '已证实',
    !record.professions?.length ? '适合专业尚未确认' : !record.formatAndRules ? '专业任务与赛制缺失' : record.professions.join('、')));
  checks.push(checked('OFFICIAL_EDITION_SOURCE','当届官方依据', official.length ? '已证实' : '待核验',
    official.length ? `已标记有效的官方来源 ${official.length} 条` : directory ? '目录只提供赛事线索，尚缺当届正式赛事页或通知' : '没有标记为有效的当届官方来源'));
  const dateConflict = /报名(?:开始|截止)?时间.*(?:疑有误|冲突)|日期冲突|报名截止日.*复核/.test(issues)
    || ['registration_start_status','registration_end_status'].some(key=>record.aiFieldVerification?.[key] === 'incorrect');
  const officialUnannounced = official.length && !record.schedule?.registration_start && !record.schedule?.registration_end
    && /官方(?:尚未|暂未|未)(?:公布|明确).*报名|当届(?:尚未|暂未|未)(?:公布|明确).*时间/.test(`${issues} ${record.schedule?.time_note || ''}`);
  checks.push(checked('REGISTRATION_TIME','报名时间', dateConflict ? '有冲突' : record.schedule?.registration_start || record.schedule?.registration_end ? '已证实' : officialUnannounced ? '官方未公布' : '待核验',
    dateConflict ? '现有报名日期存在争议，需逐项对照官方原文' : officialUnannounced ? '当届官方来源明确尚未公布' : record.schedule?.registration_end || record.schedule?.registration_start || '尚未找到当届报名时间；不得直接解释为官方未公布'));
  const registrationIssue = /报名入口.*(?:待|未|疑|不能|不应)|报名路径.*核验|报名二维码|没有.*报名网页|未取得.*报名网页/.test(issues);
  const sameAsNotice = url(record.registrationUrl) && allSources.some((source:any)=>source.url === record.registrationUrl
    && /notice|university_notice|discovery_notice|competition_directory/.test(String(source.source_type || '')));
  const hasMethod = String(record.registrationMethod || '').trim().length > 3;
  const entryVerified = url(record.registrationUrl) && !registrationIssue && !sameAsNotice && (official.length > 0 || hasMethod)
    && record.aiFieldVerification?.registration_url_correct !== false;
  checks.push(checked('REGISTRATION_ENTRY','报名方式与入口', registrationIssue || record.aiFieldVerification?.registration_url_correct === false ? '有冲突' : entryVerified ? '已证实' : '待核验',
    registrationIssue ? '现有记录提示入口或报名方式待核对' : entryVerified ? '已保存入口及相关报名说明' : url(record.registrationUrl) ? '目前的网址可能只是通知或赛事首页，尚未确认具体报名方式' : '未找到可核验的报名方式和入口'));
  const blockers = checks.filter(item => item.state === '待核验' || item.state === '有冲突').map(item=>item.code);
  const gate = getPublishBlockers(record);
  if (gate.includes('系统验证未通过')) blockers.push('SYSTEM_VALIDATION');
  if (gate.includes('人工审核未通过')) blockers.push('MANUAL_REVIEW');
  const terminal = expired || identityConflict;
  let result = '赛事范围初步可用，尚不能发布';
  let nextAction = '核对现有资料并重新执行发布条件检查';
  if (expired) { result = '当届报名已截止'; nextAction = '结束本届自动追踪；仅保留下一届线索'; }
  else if (identityConflict) { result = '赛事身份存在冲突'; nextAction = school ? '人工核对上级赛事，并处理校内选拔记录' : '人工核对标题对应的真实赛事；非赛事记录移出比赛库'; }
  else if (directory) { result = '只有目录线索，赛事身份待核验'; nextAction = '按目录中的赛事全名和主办方，寻找当届正式赛事页'; }
  else if (checks.find(item=>item.code==='OFFICIAL_EDITION_SOURCE')?.state !== '已证实') nextAction = targetUrl ? '读取已有来源并寻找主办方当届正式赛事页' : '定向搜索主办方当届正式赛事页';
  else if (checks.find(item=>item.code==='REGISTRATION_ENTRY')?.state !== '已证实') nextAction = '检查已有通知的报名说明、赛事官网报名栏目或章程';
  else if (dateConflict) nextAction = '对照当届官方原文核对报名日期冲突';
  else if (checks.find(item=>item.code==='COLLEGE_ELIGIBILITY')?.state !== '已证实') nextAction = '核对当届章程中的大学生参赛资格';
  else if (checks.find(item=>item.code==='PROFESSIONAL_SCOPE')?.state !== '已证实') nextAction = '核对专业任务与赛制，补充适合专业依据';
  else if (gate.length) nextAction = '重新执行系统验证并由管理员完成发布审核';
  else result = '现有字段满足页面发布门槛，等待正式审核与缓存验收';
  return { eventId:String(record.eventId || ''), editionId:String(record.id || ''), editionName:String(record.editionName || ''),
    result, checks, blockers:Array.from(new Set(blockers)), nextAction, targetUrl,
    lastCheckedAt:record.aiFieldVerification?.reviewed_at || record.lastVerifiedAt || null,
    pageChanged:'未知', nextCheckAt:null, attempts:null, evidenceUrls, terminal };
}
