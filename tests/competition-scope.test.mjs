import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isClearlyOutOfScope, classifyCompetitionScope, requireScopeForNewRecords } = require('../apps/miniprogram/cloudfunctions/adminData/competitionScope.js');

describe('大学生专业赛事范围', () => {
  it.each(['桂林信息科技学院 创意设计学院','上海市文化和旅游局','官宣!第二届娄底文化艺术季25场盛宴,速看安排→','2026年度韶关市群众文艺作品评选启动!快来报名吧','中国大学生服务外包创新创业大赛企业命题类赛题分析及应用','“奔跑吧,少年” 2026年黑龙江省篮球锦标赛(男子甲组) 竞赛规程','2026年教育部认可全国大学生学科竞赛目录(84项)'])('阻止真实误收样本 %s', name => {
    expect(classifyCompetitionScope({ name, organizer:'教育部', professions:['计算机与AI'], admissionVerdict:'admit' }).decision).toBe('reject');
  });
  it('资料不足只能作为线索，不能因主办单位权威变成赛事', () => {
    expect(classifyCompetitionScope({ name:'第二届新致杯创新大赛', organizer:'教育部' }).decision).toBe('pending');
  });
  it.each(['全国大学生电子设计竞赛','全国高校数字艺术设计大赛','全国大学生数学建模竞赛'])('允许专业赛事 %s', name => {
    expect(classifyCompetitionScope({ name }).decision).toBe('eligible');
  });
  it('写入接口拦截直接导入与改名绕过，同时允许删除历史脏数据', () => {
    const bad = { id:'1', name:'上海市文化和旅游局' };
    expect(() => requireScopeForNewRecords([], [bad])).toThrow('赛事范围未通过');
    expect(() => requireScopeForNewRecords([{ id:'1', name:'全国大学生程序设计竞赛' }], [bad])).toThrow();
    expect(() => requireScopeForNewRecords([bad], [])).not.toThrow();
  });
  it('任何名称或届次名称含“通知”都不得入库', () => {
    const base = { id:'notice-1', name:'全国大学生电子设计竞赛', editionName:'2026年全国大学生电子设计竞赛', participants:'高校在校生', eligibility:'高校在校生', organizer:'中国电子学会', formatAndRules:'电子设计作品评审', professions:['电子信息'], sources:[{url:'https://example.org/competition'}] };
    expect(classifyCompetitionScope({...base, name:'全国大学生电子设计竞赛报名通知'}).decision).toBe('reject');
    expect(classifyCompetitionScope({...base, editionName:'2026年赛事通知'}).decision).toBe('reject');
    expect(() => requireScopeForNewRecords([], [{...base, name:'全国大学生电子设计竞赛报名通知'}])).toThrow('不得入赛事库');
  });
  it('新入库名称不能混入年份和届次，原文可保留在届次名称', () => {
    const record = {id:'edition-2027-example', name:'2027年第九届全国大学生电子设计竞赛', editionName:'2027年第九届全国大学生电子设计竞赛', organizer:'中国电子学会', participants:'高校在校生', eligibility:'高校在校生', formatAndRules:'电子设计作品评审', professions:['电子信息'], sources:[{url:'https://example.org/competition'}]};
    expect(() => requireScopeForNewRecords([], [record])).toThrow('赛事名称只保留正文');
    expect(() => requireScopeForNewRecords([], [{...record, name:'全国大学生电子设计竞赛', editionYear:'2027', editionOrdinal:'第九届'}])).not.toThrow();
  });
  it('允许只拆分存量草稿的标题字段，不借迁移改动其他业务数据', () => {
    const before = {id:'existing-1', name:'第四届浙江农林大学新材料创新设计大赛', editionName:'第四届浙江农林大学新材料创新设计大赛', dataStatus:'draft'};
    const after = {...before, name:'浙江农林大学新材料创新设计大赛', editionYear:'', editionOrdinal:'第四届'};
    expect(() => requireScopeForNewRecords([before], [after])).not.toThrow();
    expect(() => requireScopeForNewRecords([before], [{...after, organizer:'凭空增加的主办方'}])).toThrow('赛事范围未通过');
  });
  it.each(['2026年大学生创新大赛!', '2026年大学生创新大赛！', '2026年大学生创新大赛正式启动', '2026年大学生创新大赛启动仪式', '2026年大学生创新大赛火热开启'])('拦截感叹号和活动报道标题：%s', name => {
    expect(classifyCompetitionScope({name}).decision).toBe('reject');
  });
  it('校赛选拔不得作为独立赛事，关联父赛事后才可保存为子记录', () => {
    const school = { name:'第二十届“挑战杯”全国大学生课外学术科技作品竞赛某大学校级选拔赛', participants:'高校在校生', eligibility:'高校在校生', professions:['综合/不限专业'] };
    expect(classifyCompetitionScope(school).decision).toBe('reject');
    expect(classifyCompetitionScope({ ...school, parentEventId:'event-challenge-cup-2026' }).decision).toBe('eligible');
  });
  it('拦截中小学和青少年赛事', () => {
    expect(isClearlyOutOfScope({ name:'2026中小学智能未来邀请赛' })).toBe(true);
    expect(isClearlyOutOfScope({ name:'全国青少年信息学奥林匹克竞赛' })).toBe(true);
  });
  it('拦截明确的兴趣体育活动', () => {
    expect(isClearlyOutOfScope({ name:'中国魔方运动巡回赛' })).toBe(true);
    expect(isClearlyOutOfScope({ name:'第二十届湖南省研究生男子篮球联赛' })).toBe(true);
  });
  it('保留有专业赛道的项目', () => {
    expect(isClearlyOutOfScope({ name:'中国国际飞行器设计挑战赛暨科研类全国航空航天模型锦标赛' })).toBe(false);
    expect(isClearlyOutOfScope({ name:'全国大学生电子设计竞赛' })).toBe(false);
  });
});

describe('证据优先于标题猜测', () => {
  // 2026-09-22：这三条是真被误杀过的省教育厅赛事。当时为了让它们通过，
  // 往 formatAndRules 里补写了"外语""语言文字""商务"这些词——让过滤器
  // 反过来决定数据怎么写。这里用【补写之前的原文】断言它们能通过。
  it.each([
    ['第九届“外教社杯”全国高校学生跨文化能力大赛（辽宁赛区）', '辽宁省高校在校大学生，中国学生组比赛。', '辽宁赛区比赛，设团队现场赛与短视频赛。', ['外语与教育']],
    ['2026年辽宁省高校中外大学生中华经典诵写讲大赛', '辽宁省高校中外大学生。', '设诵读与讲解两类赛项，提交作品并由专家评审。', ['人文与法学']],
    ['2026年第五届辽宁省大学生商科综合能力大赛', '辽宁省高校经管类专业在校学生。', '具体赛制以附件通知为准。', ['经管与商科']],
  ])('专业分类已判定时不再用词表猜学科：%s', (name, eligibility, formatAndRules, professions) => {
    expect(classifyCompetitionScope({ name, participants:eligibility, eligibility, formatAndRules, professions }).decision).toBe('eligible');
  });

  it('参赛对象写明非大学生时拦下，不需要系统认识这个项目', () => {
    // 靠的是参赛对象字段的实际内容，不是把"飞盘""焊工"加进黑名单。
    const fielded = { name:'2026年中国飞盘精英挑战赛', participants:'面向全国飞盘爱好者，年满16周岁即可', eligibility:'面向全国飞盘爱好者，年满16周岁即可', formatAndRules:'分组对抗，设冠亚季军', professions:['综合/不限专业'] };
    expect(classifyCompetitionScope(fielded).decision).toBe('pending');
    const worker = { ...fielded, name:'2026年全国焊接技能大赛', participants:'各企业在职焊工', eligibility:'各企业在职焊工' };
    expect(classifyCompetitionScope(worker).decision).toBe('pending');
  });

  it.each([
    '辽宁省普通高等学校在读全日制本科学生',
    '全省在校硕士研究生',
    '本省高职高专在籍学生',
  ])('认得官方通知里的各种写法：%s', eligibility => {
    // 开发时真踩过：词表写"本科生"就匹配不上"本科学生"，写"高校"就匹配不上"高等学校"。
    expect(classifyCompetitionScope({ name:'2026年某省大学生专业技能竞赛', participants:eligibility, eligibility, formatAndRules:'实操竞赛评分', professions:['机械与自动化'] }).decision).toBe('eligible');
  });

  it('标题里有"大学生"不能顶替参赛对象证据', () => {
    // 参赛对象一旦有内容，就以它为准——标题不再参与判断。
    const r = { name:'某大学生歌手挑战赛', participants:'社会各界歌唱爱好者', eligibility:'社会各界歌唱爱好者', formatAndRules:'现场演唱评选', professions:['设计与艺术'] };
    expect(classifyCompetitionScope(r).decision).toBe('pending');
  });
});

describe('榜单来源的“奖”“展”“展示”“活动”（2026-10-03 用户确认）', () => {
  const evidence = { participants:'普通高校全日制在校大学生', professions:['设计与艺术'] };
  it('来自榜单的以“奖”“展”“展示”结尾的赛事算具体赛事', () => {
    for (const name of ['时报金犊奖', '中华设计奖', '米兰设计周--中国高校设计学科师生优秀作品展', '全国大学生创新创业训练计划年会展示', '“高教社杯”高等学校（本科）“用外语讲中国故事”优秀短视频作品征集活动']) {
      expect(classifyCompetitionScope({ name, curationList:'2025年教育部认可的全国大学生学科竞赛目录', ...evidence }).decision, name).toBe('eligible');
    }
  });
  it('不是榜单来源的照旧拒收', () => {
    expect(classifyCompetitionScope({ name:'时报金犊奖', ...evidence }).reason).toBe('标题不是一场具体比赛');
    expect(classifyCompetitionScope({ name:'优秀作品展', ...evidence }).reason).toBe('标题不是一场具体比赛');
    expect(classifyCompetitionScope({ name:'优秀短视频作品征集活动', ...evidence }).reason).toBe('标题不是一场具体比赛');
  });
});
