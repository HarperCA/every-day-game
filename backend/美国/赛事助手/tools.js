// 两个工具：查比赛、追问用户。工具参数一律由这里的代码校验，不信任模型给的任何值。
const { filterPublicRecords } = require('./publicQuery');
const { PROFESSION_CATEGORIES } = require('./askValidation');

// 取值与小程序筛选项一致（apps/miniprogram/services/filterOptions.ts）
const EVENT_LEVELS = ['国际级', '国家级', '省级/区域级', '其他/未明确'];
const PARTICIPATION_FORMATS = ['个人赛', '团队赛', '个人或团队均可'];
const REGISTRATION_STATUSES = ['报名中', '即将报名', '时间待公布', '已截止'];
const REGISTRATION_WITHIN = ['1m', '3m', '6m'];
const FEE_TYPES = ['免费', '收费', '不同赛项费用不同'];
const MAX_KEYWORD_CHARS = 30;
const MODEL_RESULT_LIMIT = 5;   // 给模型看几场：和卡片一样多，回答里点名的比赛都在卡片里
const CARD_LIMIT = 5;           // 给用户几张卡片
const MAX_OPTIONS = 4;

// 地区取值不写死：公开缓存里的 region 有省份全称，也有“台湾地区”“华东地区”“国际”这类写法
// （competitionValue.js 的 inferCompetitionRegion），而筛选是精确匹配。
// 和“找比赛”页一样，从这次读到的比赛里取实际出现过的值（pages/index/index.ts 的 regionOptions）。
function regionsOf(records) {
  return [...new Set(records.map(item => String(item.region || '').trim()).filter(Boolean))].sort();
}

function buildTools(regions = []) {
  const region = regions.length
    ? { type:'string', enum:regions, description:'比赛面向的地区。只在用户明确要本地区的比赛时才填；全国性比赛的地区是“全国”。' }
    : null;
  return [
    { type:'function', function:{
      name:'search_competitions',
      description:'在本平台赛事库里查比赛。只能用这里查到的比赛回答用户。所有参数都可以不填；不填就是不限。',
      parameters:{ type:'object', additionalProperties:false, properties:{
        keyword:{ type:'string', description:'比赛名称或主题里的关键词，例如“围棋”“数学建模”。专业不要写在这里，用 professions。' },
        professions:{ type:'array', items:{ type:'string', enum:PROFESSION_CATEGORIES }, description:'适合的专业大类，可多选，满足其一即可' },
        eventLevel:{ type:'string', enum:EVENT_LEVELS },
        participationFormats:{ type:'array', items:{ type:'string', enum:PARTICIPATION_FORMATS },
          description:'参赛形式，可多选。用户说“能组队”时选 团队赛 和 个人或团队均可' },
        registrationStatus:{ type:'string', enum:REGISTRATION_STATUSES },
        registrationWithin:{ type:'string', enum:REGISTRATION_WITHIN,
          description:'多久之内能报名：1m=一个月内（含正在报名的），3m=三个月内，6m=半年内' },
        ...(region ? { region } : {}),
        feeType:{ type:'string', enum:FEE_TYPES },
        sortBy:{ type:'string', enum:['deadline', 'time'], description:'排序方式。用户问“快截止的、最近要截止的”时填 deadline（按报名截止日从近到远）；time 是按“离能开始报名还有多久”排，不是截止日期，不要用来表示快截止。' },
      } },
    } },
    { type:'function', function:{
      name:'ask_user',
      description:'条件不够、无法判断用户要什么时，问用户一个问题，并给 2 到 4 个可点选的选项。每次只问一个问题。',
      parameters:{ type:'object', additionalProperties:false, required:['question', 'options'], properties:{
        question:{ type:'string' },
        options:{ type:'array', items:{ type:'string' } },
      } },
    } },
  ];
}

const pickEnum = (value, allowed) => (typeof value === 'string' && allowed.includes(value) ? value : undefined);
const pickEnumList = (value, allowed) => (Array.isArray(value) ? [...new Set(value.filter(item => allowed.includes(item)))] : []);

function parseArguments(rawArguments) {
  if (typeof rawArguments !== 'string') return rawArguments;
  try { return JSON.parse(rawArguments); } catch (_ignored) { return undefined; }
}

// 模型给的参数是一段 JSON 字符串。解析不了、取值不在白名单里的，丢掉并记下来（dropped），不报错。
function sanitizeSearchArgs(rawArguments, regions = []) {
  const args = parseArguments(rawArguments);
  if (args === undefined) return { query:{}, dropped:['_unparseable'] };
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { query:{}, dropped:['_not_object'] };
  const query = {};
  const dropped = [];
  const keyword = typeof args.keyword === 'string' ? Array.from(args.keyword.trim()).slice(0, MAX_KEYWORD_CHARS).join('') : '';
  if (keyword) query.keyword = keyword;
  else if (args.keyword !== undefined && args.keyword !== '') dropped.push('keyword');
  const lists = { professions:PROFESSION_CATEGORIES, participationFormats:PARTICIPATION_FORMATS };
  for (const [key, allowed] of Object.entries(lists)) {
    const kept = pickEnumList(args[key], allowed);
    if (kept.length) query[key] = kept;
    if (args[key] !== undefined && (!Array.isArray(args[key]) || kept.length !== new Set(args[key]).size)) dropped.push(key);
  }
  const singles = { eventLevel:EVENT_LEVELS, registrationStatus:REGISTRATION_STATUSES, registrationWithin:REGISTRATION_WITHIN,
    region:regions, feeType:FEE_TYPES, sortBy:['deadline', 'time'] };
  for (const [key, allowed] of Object.entries(singles)) {
    const kept = pickEnum(args[key], allowed);
    if (kept) query[key] = kept;
    else if (args[key] !== undefined && args[key] !== '') dropped.push(key);
  }
  for (const key of Object.keys(args)) if (key !== 'keyword' && !(key in lists) && !(key in singles)) dropped.push(key);
  return { query, dropped };
}

// 报名截止的时刻：纯日期按北京时间当天结束算，带时间的按那个时刻算；认不出来返回 null
function deadlineInstant(value) {
  const text = String(value || '');
  const instant = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T23:59:59.999+08:00`) : /^\d{4}-\d{2}-\d{2}T/.test(text) ? Date.parse(text) : NaN;
  return Number.isFinite(instant) ? instant : null;
}

// 按报名截止日从近到远：还能报名的在前（没有截止日的排在它们后面），已截止、已归档的垫底
function sortByDeadline(items, now) {
  const closed = item => item.registration_status === '已截止' || item.data_status === 'archived' || (deadlineInstant(item.registration_end) ?? Infinity) < now.getTime();
  const key = item => deadlineInstant(item.registration_end) ?? Infinity;
  const open = items.filter(item => !closed(item));
  return [...open.slice().sort((a, b) => key(a) - key(b)), ...items.filter(closed)];
}

// filterPublicRecords 的专业、参赛形式只认单个值；多选在这里先筛一遍，再交给它做其余筛选和排序。
// sortBy:'deadline' 是助手自己的排序：先取出全部符合条件的（页数上限内），再按截止日排。
function runSearch(records, query, now = new Date()) {
  const { professions = [], participationFormats = [], sortBy, ...rest } = query;
  const subset = records.filter(item =>
    (!professions.length || (item.professions || []).some(value => professions.includes(value)))
    && (!participationFormats.length || participationFormats.includes(item.participation_format)));
  if (sortBy !== 'deadline') return filterPublicRecords(subset, { ...rest, ...(sortBy ? { sortBy } : {}), page:1, pageSize:MODEL_RESULT_LIMIT }, now);
  const all = filterPublicRecords(subset, { ...rest, page:5, pageSize:100 }, now);
  return { ...all, items:sortByDeadline(all.items, now).slice(0, MODEL_RESULT_LIMIT), hasMore:all.total > MODEL_RESULT_LIMIT };
}

// 给模型看的结果：只给回答需要的字段，不给链接（回答里不许出现链接，见 assistantCore.js）。
function compactForModel(result) {
  return {
    total:result.total,
    shown:result.items.map(item => ({
      id:item.id, name:item.name, edition:item.edition_name, level:item.event_level,
      status:item.registration_status, registration_start:item.registration_start, registration_end:item.registration_end,
      registration_end_note:item.registration_end_note || '', professions:item.professions || [],
      format:item.participation_format, region:item.region || '', fee:item.fee_type,
      // 主办方（2026-10-24）：用户常问“谁主办的”，原先没给模型，模型只能答“库里没有”
      organizer:String(item.organizer || '').slice(0, 120),
    })),
  };
}

// 距离截止还有几天（向上取整）。公开缓存里的截止既有纯日期（2026-10-28，按北京时间当天结束算），
// 也有带时间的（2026-10-30T00:00:00+08:00，按这个时刻算）；认不出来返回 null
function daysLeft(value, now = new Date()) {
  const text = String(value || '');
  const end = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T23:59:59.999+08:00`) : /^\d{4}-\d{2}-\d{2}T/.test(text) ? Date.parse(text) : NaN;
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86400000));
}

function toCard(item, now = new Date()) {
  return {
    id:item.id, name:item.name, editionName:item.edition_name || '', eventLevel:item.event_level || '',
    registrationStatus:item.registration_status || '', registrationEnd:item.registration_end || null,
    registrationEndNote:item.registration_end_note || '', daysLeft:daysLeft(item.registration_end, now),
  };
}

function sanitizeAskUser(rawArguments) {
  const args = parseArguments(rawArguments) || {};
  const question = typeof args.question === 'string' ? Array.from(args.question.trim()).slice(0, 120).join('') : '';
  const options = (Array.isArray(args.options) ? args.options : [])
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => Array.from(value.trim()).slice(0, 16).join('')).slice(0, MAX_OPTIONS);
  return { question, options };
}

module.exports = { buildTools, regionsOf, CARD_LIMIT, MODEL_RESULT_LIMIT, sanitizeSearchArgs, runSearch, compactForModel, toCard, daysLeft, sanitizeAskUser,
  EVENT_LEVELS, PARTICIPATION_FORMATS, REGISTRATION_STATUSES, REGISTRATION_WITHIN, FEE_TYPES };
