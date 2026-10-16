// 搜索框按“专业”找比赛（2026-10-01）：学生搜“计算机”“土木工程”“临床医学”时，
// 除了比赛名称、主办方里含这个词的，还要找出专业大类对得上的比赛。
//
// 库里每场比赛的 professions 是十三类专业大类（见 adminData/competitionAiReview.js 的 PROFESSION_TAXONOMY），
// 学生搜的却是具体专业名，所以这里放一份“专业名 / 专业关键词 → 专业大类”的对应表。
// 对应关系只是搜索入口，不改变比赛本身的专业分类。“综合/不限专业”不参与词表（搜“不限”靠比赛名称和说明）。

const MAJOR_TERMS = {
  '计算机与AI':['计算机科学与技术', '计算机', '软件工程', '软件', '人工智能', '数据科学与大数据技术', '大数据', '数据科学', '网络空间安全', '网络安全', '信息安全',
    '物联网工程', '物联网', 'AI', '智能科学与技术', '数字媒体技术', '区块链', '机器学习', '深度学习', '算法', '程序设计', '编程', '云计算', '信息管理与信息系统', '信息系统'],
  '电子信息':['电子信息工程', '电子信息', '通信工程', '通信', '电子科学与技术', '电子科学', '微电子', '集成电路', '光电信息', '光电', '电气工程及其自动化', '电气工程', '电气',
    '信息工程', '测控技术与仪器', '测控', '嵌入式', '芯片', '电路', '无线电', '仪器', '雷达', '电力'],
  '机械与自动化':['机械设计制造及其自动化', '机械工程', '机械', '自动化', '机器人工程', '机器人', '车辆工程', '智能制造', '工业工程', '智能车', '无人机', '航空航天', '飞行器', '船舶', '海洋工程',
    '兵器', '制造', '数控', '过程装备', '机电'],
  '建筑与土木':['土木工程', '土木', '建筑学', '建筑', '城乡规划', '城市规划', '风景园林', '园林', '给排水', '工程管理', '工程造价', '测绘工程', '测绘', '交通工程', '道路桥梁', '桥梁',
    '水利水电', '水利', '结构', 'BIM', '安全工程', '消防', '房地产', '装配式'],
  '材料与化工':['材料科学与工程', '材料科学', '材料', '化学工程与工艺', '化学工程', '化工', '化学', '应用化学', '高分子', '冶金', '金属', '纺织', '轻化工程', '焊接', '金相', '热处理', '陶瓷', '复合材料'],
  '能源与环境':['能源与动力工程', '能源', '动力', '环境工程', '环境科学', '环境', '新能源', '核工程', '储能', '节能减排', '节能', '地质', '资源', '采矿', '石油', '碳中和', '生态', '光伏', '环保'],
  '生物与医药':['生物工程', '生物技术', '生物科学', '生物', '生命科学', '临床医学', '医学', '药学', '制药', '中药', '护理', '口腔', '公共卫生', '预防医学', '基础医学', '医学检验',
    '生物医学工程', '生物医学', '食品科学', '食品', '农学', '农业', '园艺', '林学', '动物', '兽医', '植物', '健康', '康复', '医药'],
  '经管与商科':['金融学', '金融', '会计学', '会计', '工商管理', '市场营销', '营销', '经济学', '经济', '国际贸易', '贸易', '电子商务', '电商', '财务管理', '财务', '审计', '管理', '物流', '供应链',
    '税务', '保险', '创业', '人力资源', '管理科学', '旅游管理', '商务', '商科', '投资', '统计与会计'],
  '人文与法学':['法学', '法律', '新闻传播学', '新闻传播', '新闻', '传播', '汉语言文学', '汉语言', '中文', '文学', '历史学', '历史', '哲学', '政治学', '政治', '社会学', '公共管理', '行政管理',
    '心理学', '心理', '马克思主义', '思政', '国学', '汉字', '书法', '档案', '人文', '社会工作', '图书馆'],
  '外语与教育':['英语', '外语', '翻译', '日语', '俄语', '德语', '法语', '西班牙语', '韩语', '商务英语', '师范', '教育学', '教育技术', '小学教育', '学前教育', '语言学', '汉语国际教育', '体育教育', '教育', '教师'],
  '设计与艺术':['工业设计', '视觉传达设计', '视觉传达', '设计', '艺术设计', '环境设计', '产品设计', '服装设计', '数字媒体艺术', '动画', '美术', '音乐', '舞蹈', '戏剧', '影视', '摄影', '广告', '艺术', '文创', '包装'],
  '数学与统计':['数学', '应用数学', '统计学', '统计', '数学建模', '信息与计算科学', '物理学', '物理', '应用物理', '数据分析', '运筹'],
};

// 十三类大类名本身也可以直接搜（“计算机与AI”“材料与化工”）
const CATEGORY_NAMES = ['综合/不限专业', ...Object.keys(MAJOR_TERMS)];

const TERMS = Object.entries(MAJOR_TERMS).flatMap(([category, terms]) => terms.map(term => ({ term:term.toLowerCase(), category })));
const { majors } = require('./undergraduateMajors2026.json');
const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
const CATALOG = majors.map(major => ({ ...major, normalizedName: normalize(major.name) }));
const EXACT_MAJORS = new Map();
for (const major of CATALOG) {
  EXACT_MAJORS.set(major.normalizedName, major.categories);
  EXACT_MAJORS.set(normalize(major.code), major.categories);
}

// 学生常带的后缀：“计算机专业”“土木类”“临床医学系”，匹配前先去掉
function stripSuffix(keyword) {
  let result = keyword;
  while (true) {
    const next = result.replace(/(类专业|专业类|专业|学院|方向|类|系)$/, '');
    if (next === result) return result;
    result = next;
  }
}

// 返回搜索词对应的专业大类（可能多个，空数组表示这个词不像专业名）。
// 规则：搜索词和词表里的某个词“互相包含”（至少 2 个字符）就算对上：
//   “计算机”对上“计算机科学与技术”；“土木工程专业”去掉后缀后对上“土木工程”；单个字不匹配，避免“法”“化”之类乱匹配。
function majorCategories(rawKeyword) {
  const base = normalize(rawKeyword);
  const keyword = stripSuffix(base);
  // 具体专业完整名称和代码优先，避免经济统计学、软件工程被泛词串到其他类。
  const exact = EXACT_MAJORS.get(base) || EXACT_MAJORS.get(keyword);
  if (exact) return [...exact];
  // 比赛名称仍由普通文本搜索匹配，不能因名称里出现一个专业词而扩大结果。
  if (/(竞赛|比赛|赛事|大赛|挑战杯)/.test(base)) return [];
  const found = new Set();
  for (const name of CATEGORY_NAMES) if (name.toLowerCase() === base || name.toLowerCase() === keyword) found.add(name);
  if (['不限', '不限专业', '综合', '各专业', '所有专业'].includes(keyword)) found.add('综合/不限专业');
  if (keyword.length >= 2) {
    for (const { term, category } of TERMS) {
      // 两个字的搜索词只按“词的开头”对：“设计”对“设计”“设计学”，不对“程序设计”“机械设计制造及其自动化”，免得搜“设计”把别的专业全带出来；
      // 三个字以上才允许出现在词的中间
      const inside = keyword.length >= 3 ? term.includes(keyword) : term.startsWith(keyword);
      // 搜索词比词表里的词长（“我想找计算机”）时，只认三个字以上的词，免得“程序设计”因为含“设计”被算成艺术类
      if (inside || (term.length >= 3 && keyword.includes(term))) found.add(category);
    }
  }
  // 仅补充专业名称的较长前缀；两字泛词（如设计）不遍历整个目录。
  // 也不将含有专业名的任意长句当作专业。
  if (keyword.length >= 3 && /^[\u4e00-\u9fff]+$/.test(keyword)) {
    for (const major of CATALOG) {
      if (major.normalizedName.startsWith(keyword)) {
        for (const category of major.categories) found.add(category);
      }
    }
  }
  return [...found];
}

module.exports = { MAJOR_TERMS, majorCategories, stripSuffix };
