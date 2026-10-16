// 赛事助手测试共用的假数据：公开缓存里的比赛（字段与 adminData/publicCache.js 的 toPublicCache 一致的那部分）
export const NOW = new Date('2026-10-16T04:00:00Z'); // 北京时间 2026-10-16 12:00

export function publicRecord(overrides = {}) {
  return {
    id:'edition-a', event_id:'event-a', name:'全国大学生智能汽车竞赛', edition_name:'第二十一届',
    data_status:'published', system_validation:'passed', manual_review:'passed',
    event_level:'国家级', professions:['计算机与AI', '电子信息'], participation_format:'团队赛',
    team_size_category:'2～3人', fee_type:'免费', registration_organization:'学校统一报名', region:'全国',
    registration_start:'2026-10-01', registration_end:'2026-10-28', registration_end_note:'',
    competition_start:'2026-11-20', competition_end:'2026-11-22',
    registration_url:'https://example.com/register', sources:[{ id:'s1', source_type:'official', url:'https://example.com' }],
    search_text:'全国大学生智能汽车竞赛 第二十一届', sort_weight:1, objective_tags:[],
    ...overrides,
  };
}

export const RECORDS = [
  publicRecord(),
  publicRecord({ id:'edition-b', event_id:'event-b', name:'中国大学生计算机设计大赛', participation_format:'个人或团队均可',
    registration_end:'2026-11-10', search_text:'中国大学生计算机设计大赛', professions:['计算机与AI', '设计与艺术'] }),
  publicRecord({ id:'edition-c', event_id:'event-c', name:'外研社杯全国英语演讲大赛', participation_format:'个人赛',
    professions:['外语与教育'], search_text:'外研社杯全国英语演讲大赛', region:'国际', event_level:'国际级' }),
  publicRecord({ id:'edition-d', event_id:'event-d', name:'浙江省大学生机械设计竞赛', participation_format:'团队赛',
    professions:['机械与自动化'], search_text:'浙江省大学生机械设计竞赛', region:'浙江省', event_level:'省级/区域级' }),
  publicRecord({ id:'edition-draft', name:'还没审核的比赛', manual_review:'pending', search_text:'还没审核的比赛' }),
];
