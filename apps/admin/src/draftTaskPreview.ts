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

// AI 核验按字段列出与原文的出入，字段名写法不统一（organizer、schedule.registration_end、fees_eligibility、主办方……），
// 按关键词归到发布条件上。报名费用、比赛日期不是发布条件，不归入。
const AI_FIELD_CHECKS:[RegExp,string][] = [
  [/event_identity|edition|届次|name/i, 'EVENT_IDENTITY'],
  [/organi[sz]er|主办/i, 'ORGANIZER'],
  [/eligib|participant|资格|对象/i, 'COLLEGE_ELIGIBILITY'],
  [/format|rules|team|赛制|团队/i, 'PROFESSIONAL_SCOPE'],
  [/source|evidence|来源/i, 'OFFICIAL_EDITION_SOURCE'],
  [/registration_(?:start|end|time|deadline)|schedule\.registration|^schedule(?:_registration)?$|registration_deadline|报名时间/i, 'REGISTRATION_TIME'],
  [/registration_(?:url|method|organization)|^registration$|entry|报名方式|入口/i, 'REGISTRATION_ENTRY'],
];
// “改为……”“与来源不符”这类是现有字段写错了；“缺少”“为空”“无法确认”只是没核到。
const AI_CONFLICT = /不符|不一致|颠倒|有误|错误|矛盾|泛化|却为|却写|实为|应为|改为|并非|不是/;

function aiIssuesByCheck(record:any) {
  const review = record.aiReview || {};
  const out = new Map<string, { state:EvidenceState; findings:string[] }>();
  if (review.decision === 'recommend_approve') return out;
  for (const issue of Array.isArray(review.issues) ? review.issues : []) {
    const field = String(issue?.field || '');
    const finding = String(issue?.finding || '');
    const state:EvidenceState = AI_CONFLICT.test(finding) ? '有冲突' : '待核验';
    for (const [pattern, code] of AI_FIELD_CHECKS) {
      if (!pattern.test(field)) continue;
      const current = out.get(code) || { state:'待核验' as EvidenceState, findings:[] };
      if (state === '有冲突') current.state = '有冲突';
      current.findings.push(finding.slice(0, 80));
      out.set(code, current);
    }
  }
  return out;
}

// 字段有值不等于已证实：要有能打开的当届官方来源、AI 核验没有指出出入，才算已证实。
function settle(check:DraftCheck, ai:Map<string,{state:EvidenceState;findings:string[]}>, provable:boolean, unprovableReason:string):DraftCheck {
  const hit = ai.get(check.code);
  if (hit && check.state !== '有冲突') {
    return { ...check, state:hit.state, detail:`AI 核验：${hit.findings.slice(0, 2).join('；')}` };
  }
  if (check.state === '已证实' && !provable) return { ...check, state:'待核验', detail:`${check.detail}（${unprovableReason}）` };
  return check;
}

export function previewDraftTask(record:any, now = new Date()):DraftTaskPreview {
  const issues = texts(record);
  const allSources = Array.isArray(record.sources) ? record.sources : [];
  const directory = /目录线索|目录为立项|目录文件不能充当报名入口|仅有.*目录|赛事目录/.test(issues)
    || /directory/i.test(String(record.ruleVersion || ''))
    || allSources.some((source:any)=>source.source_type === 'competition_directory');
  const officialSources = allSources.filter((source:any) => source.is_official && source.validity_status === 'valid'
    && !['discovery_notice','university_notice','search_candidate','competition_directory'].includes(source.source_type) && url(source.url));
  // 立项目录是教育厅文件，能证明赛事存在、主办方和参赛对象，但不是当届赛事通知。
  const official = directory ? [] : officialSources;
  const sourceUrls = allSources.map((source:any)=>source.url).filter(url);
  const evidenceUrls = Array.from(new Set([...officialSources.map((source:any)=>source.url),...sourceUrls])).slice(0,6) as string[];
  const targetUrl = evidenceUrls[0] || (url(record.websiteUrl) ? record.websiteUrl : null);
  const end = Date.parse(record.schedule?.registration_end || '');
  const expired = Number.isFinite(end) && end < now.getTime();
  // 标题是校赛，或质量问题明确说这条记录本身只面向本校；“须核对所在学校的校赛安排”这类提醒不算。
  const school = /校级选拔赛|校内选拔|校内推荐赛|学院选拔赛|校赛|院赛/.test(record.name || '')
    || /仅面向本校|只面向本校|(?:记录|条目|本条)(?:为|是|属于)(?:校赛|校内选拔|校级)/.test(issues);
  const invalidTitle = /通知|目录|清单|公告|公示|获奖|喜报|大赛动态|赛事指南|正式启动|[!！]/.test(record.name || '');
  const identityConflict = invalidTitle || school;
  const evidence = Array.isArray(record.aiReview?.evidence_status) ? record.aiReview.evidence_status : [];
  const aiBlind = evidence.length > 0 && evidence.every((item:any) => item?.status !== 'reachable');
  // 省平台等来源不让程序抓取，AI 打不开；人工按原文核对过的来源存有原文摘录，不算未经比对，
  // AI 在没读到原文时提出的意见也不采用。
  const excerpted = officialSources.some((source:any) => String(source.evidence_excerpt || '').trim().length >= 20);
  const unreachable = aiBlind && !excerpted;
  const ai = aiBlind ? new Map<string,{state:EvidenceState;findings:string[]}>() : aiIssuesByCheck(record);
  const noticePending = /notice_resolution_pending|通知线索待追溯/.test(issues);
  const tracing = record.triage?.bucket === '需要追溯' && record.dataStatus === 'draft';
  const editionProven = official.length > 0 && !noticePending && !tracing && !unreachable;
  const unprovableReason = unreachable ? 'AI 核验时来源打不开，字段未经比对'
    : directory ? '依据是立项目录，当届正式通知尚未取得'
    : tracing ? `分诊待追溯：${String(record.triage?.traceTodo || '').slice(0, 60)}`
    : noticePending ? '通知线索尚未追溯到赛事本体' : '没有标记为有效的当届官方来源';
  // 目录能证明身份、主办方和参赛对象；时间、入口、赛制必须来自当届正式来源。
  const identityProvable = officialSources.length > 0 && !unreachable;

  const checks:DraftCheck[] = [];
  checks.push(settle(checked('EVENT_IDENTITY','独立赛事身份', identityConflict ? '有冲突' : '已证实',
    identityConflict ? (school ? '记录涉及校内选拔或校内推荐，须核对上级赛事' : '标题呈现通知、目录、报道或宣传语')
      : directory ? '立项目录列明了该赛事；当届赛事本体待追到' : '标题未命中已知非赛事或下级选拔特征'), ai, identityProvable, unprovableReason));
  checks.push(settle(checked('ORGANIZER','主办方', !String(record.organizer || '').trim() || /主办方待确认|主办单位.*未写明/.test(issues) ? '待核验' : '已证实',
    record.organizer || '尚未录入主办方'), ai, identityProvable, unprovableReason));
  const audience = `${record.participants || ''} ${record.eligibility || ''}`;
  // “在校学生”本身分不出大学还是中小学，赛事名称写明大学生或高校时才算。
  const college = /大学生|本科|专科|研究生|硕士|博士|高职|高校|高等(?:学校|院校)|在校生|在读生/i.test(audience)
    || (/在校学生|在读学生/.test(audience) && /大学生|研究生|高校|高等(?:学校|院校)/.test(record.name || ''));
  checks.push(settle(checked('COLLEGE_ELIGIBILITY','大学生参赛资格', !audience.trim() ? '待核验' : college ? '已证实' : '有冲突',
    !audience.trim() ? '没有参赛对象及资格依据' : college ? audience.trim().slice(0, 60) : '现有资格字段不能确认大学生可以参赛'), ai, identityProvable, unprovableReason));
  checks.push(settle(checked('PROFESSIONAL_SCOPE','专业任务与分类', !String(record.formatAndRules || '').trim() || !record.professions?.length ? '待核验' : '已证实',
    !record.professions?.length ? '适合专业尚未确认' : !record.formatAndRules ? '专业任务与赛制缺失' : record.professions.join('、')), ai, editionProven, unprovableReason));
  checks.push(settle(checked('OFFICIAL_EDITION_SOURCE','当届官方依据', editionProven ? '已证实' : '待核验',
    editionProven ? `已标记有效的官方来源 ${official.length} 条` : unprovableReason), ai, editionProven, unprovableReason));
  const dateConflict = /报名(?:开始|截止)?时间.*(?:疑有误|冲突)|日期冲突|报名截止日.*复核/.test(issues)
    || ['registration_start_status','registration_end_status'].some(key=>record.aiFieldVerification?.[key] === 'incorrect');
  const officialUnannounced = editionProven && !record.schedule?.registration_start && !record.schedule?.registration_end
    && /官方(?:尚未|暂未|未)(?:公布|明确).*报名|当届(?:尚未|暂未|未)(?:公布|明确).*时间/.test(`${issues} ${record.schedule?.time_note || ''}`);
  checks.push(settle(checked('REGISTRATION_TIME','报名时间', dateConflict ? '有冲突' : record.schedule?.registration_start || record.schedule?.registration_end ? '已证实' : officialUnannounced ? '官方未公布' : '待核验',
    dateConflict ? '现有报名日期存在争议，需逐项对照官方原文' : officialUnannounced ? '当届官方来源明确尚未公布' : record.schedule?.registration_end || record.schedule?.registration_start || record.schedule?.status_override || '尚未找到当届报名时间；不得直接解释为官方未公布'), ai, editionProven, unprovableReason));
  const registrationIssue = /报名入口.*(?:待|未|疑|不能|不应)|报名路径.*核验|报名二维码|没有.*报名网页|未取得.*报名网页|registration_url_pending/.test(issues);
  const sameAsNotice = url(record.registrationUrl) && allSources.some((source:any)=>source.url === record.registrationUrl
    && /notice|university_notice|discovery_notice|competition_directory/.test(String(source.source_type || '')));
  const hasMethod = String(record.registrationMethod || '').trim().length > 3;
  const entryVerified = url(record.registrationUrl) && !registrationIssue && !sameAsNotice && (official.length > 0 || hasMethod)
    && record.aiFieldVerification?.registration_url_correct !== false;
  checks.push(settle(checked('REGISTRATION_ENTRY','报名方式与入口', record.aiFieldVerification?.registration_url_correct === false ? '有冲突' : entryVerified ? '已证实' : '待核验',
    registrationIssue ? '现有记录提示入口或报名方式待核对' : entryVerified ? '已保存入口及相关报名说明' : url(record.registrationUrl) ? '目前的网址可能只是通知或赛事首页，尚未确认具体报名方式' : '未找到可核验的报名方式和入口'), ai, editionProven, unprovableReason));

  const blockers = checks.filter(item => item.state === '待核验' || item.state === '有冲突').map(item=>item.code);
  const gate = getPublishBlockers(record);
  if (gate.includes('系统验证未通过')) blockers.push('SYSTEM_VALIDATION');
  if (gate.includes('人工审核未通过')) blockers.push('MANUAL_REVIEW');
  const identityCheck = checks[0];
  const conflicts = checks.filter(item => item.state === '有冲突');
  const terminal = expired || identityConflict;
  let result = '赛事范围初步可用，尚不能发布';
  let nextAction = '核对现有资料并重新执行发布条件检查';
  if (expired) { result = '当届报名已截止'; nextAction = '结束本届自动追踪；仅保留下一届线索'; }
  else if (identityConflict) { result = '赛事身份存在冲突'; nextAction = school ? '人工核对上级赛事，并处理校内选拔记录' : '人工核对标题对应的真实赛事；非赛事记录移出比赛库'; }
  else if (identityCheck.state === '有冲突') { result = '赛事身份存在冲突'; nextAction = '对照原文核实这是否为独立的大学生赛事（而非赛题、赛道或校内环节）'; }
  else if (directory) { result = '只有目录线索，当届赛事待追到'; nextAction = '按目录中的赛事全名和主办方，寻找当届正式赛事通知'; }
  else if (unreachable) { result = '来源打不开，字段未经比对'; nextAction = '重新打开来源或另找主办方原文，逐项比对后再审'; }
  else if (!editionProven) { result = '缺当届官方原文'; nextAction = tracing ? `按分诊要求追溯：${String(record.triage?.traceTodo || '').slice(0, 60)}` : targetUrl ? '读取已有来源并寻找主办方当届正式赛事页' : '定向搜索主办方当届正式赛事页'; }
  else if (conflicts.length) { result = '字段与原文有出入'; nextAction = `按官方原文改正：${conflicts.map(item => item.label).join('、')}`; }
  else if (checks.find(item=>item.code==='REGISTRATION_ENTRY')?.state !== '已证实') nextAction = '检查已有通知的报名说明、赛事官网报名栏目或章程';
  else if (checks.find(item=>item.code==='COLLEGE_ELIGIBILITY')?.state !== '已证实') nextAction = '核对当届章程中的大学生参赛资格';
  else if (checks.find(item=>item.code==='PROFESSIONAL_SCOPE')?.state !== '已证实') nextAction = '核对专业任务与赛制，补充适合专业依据';
  else if (checks.find(item=>item.code==='REGISTRATION_TIME')?.state === '待核验') nextAction = '在当届官方原文中找报名时间';
  else if (gate.length) nextAction = '重新执行系统验证并由管理员完成发布审核';
  else result = '现有字段满足页面发布门槛，等待正式审核与缓存验收';
  return { eventId:String(record.eventId || ''), editionId:String(record.id || ''), editionName:String(record.editionName || ''),
    result, checks, blockers:Array.from(new Set(blockers)), nextAction, targetUrl,
    lastCheckedAt:record.aiReview?.reviewed_at || record.aiFieldVerification?.reviewed_at || record.lastVerifiedAt || null,
    pageChanged:'未知', nextCheckAt:null, attempts:null, evidenceUrls, terminal };
}
