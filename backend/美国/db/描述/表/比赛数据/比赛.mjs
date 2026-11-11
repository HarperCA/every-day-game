// 一级：比赛。放不随届次变的信息。编号沿用旧的 eventId，永不改。
// 删除先打标记（deleted_at），默认读不到，只在后台回收站里看得到；30 天后由后台回收站调通用的彻底删除真删。
// 旧字段名写在“旧”里（旧总表 admin_state/competitions 每条记录的键），建库时按它搬。
import { LIMITS } from '../../../../../共用/db/字段类型.mjs';

export default {
  表名: 'competition',
  说明: '比赛（一级）',
  主键: 'id',
  删除标记: 'deleted_at',
  字段: {
    id: { 说明: '比赛编号，沿用旧的 eventId', 必填: true, 类型: '编号', 旧: 'eventId' },
    name: { 说明: '比赛名称', 必填: true, 类型: '文字', 最长: LIMITS.短, 旧: 'name' },
    aliases: { 说明: '别名、简称、曾用名', 必填: false, 类型: '列表', 旧: 'aliases' },
    website: { 说明: '官网；旧记录没有这一项，建库时从类型为官网的来源里取', 必填: false, 类型: '网址', 最长: LIMITS.网址 },
    parent_id: { 说明: '上级比赛（省赛、校赛指向国赛）', 必填: false, 类型: '编号', 指向: 'competition', 旧: 'parentEventId' },
    level: { 说明: '级别', 必填: true, 类型: '文字', 可选值: ['国际级', '国家级', '省级/区域级', '其他/未明确'], 旧: 'eventLevel' },
    organizer: { 说明: '主办方', 必填: false, 类型: '文字', 最长: LIMITS.短, 旧: 'organizer' },
    region: { 说明: '省级行政区名；国家级、国际级留空', 必填: false, 类型: '文字', 最长: 20, 旧: 'region' },
    professions: { 说明: '适合的专业分类（十三类）；为空时不能公开', 必填: false, 类型: '列表', 旧: 'professions' },
    objective_tags: { 说明: '方向标签', 必填: false, 类型: '列表', 旧: 'objectiveTags' },
    lifecycle: { 说明: '举办情况', 必填: false, 类型: '文字', 可选值: ['长期举办', '首届', '不定期', '疑似停办', '已停办', '暂未明确'], 旧: 'lifecycle' },
    recognition: { 说明: '认可度：分保研考研、求职就业、出国留学、创业融资，每条带出处', 必填: false, 类型: '对象', 旧: 'recognition' },
    curation_list: { 说明: '出自哪份权威榜单（教育部认可目录等）', 必填: false, 类型: '文字', 最长: LIMITS.短, 旧: 'curationList' },
    last_maintained_at: { 说明: '上次维护时间：维护每天 9:00–18:00 每 5 分钟挑一个 7 天内没维护过、上次最早的比赛（2026-11-01 用户定）', 必填: false, 类型: '时间' },
    manual_fields: { 说明: '人工改过的字段：机器发现这些字段有问题时不自己改，只标待人工审核', 必填: false, 类型: '列表' },
    deleted_at: { 说明: '标记删除的时间；有值就算已删除，30 天后真删', 必填: false, 类型: '时间' },
    deleted_by: { 说明: '谁标记删除的', 必填: false, 类型: '文字', 最长: 80 },
    version: { 说明: '版本号，每改一次加一', 必填: true, 类型: '整数' },
    created_at: { 说明: '建立时间', 必填: true, 类型: '时间' },
    updated_at: { 说明: '最后修改时间', 必填: true, 类型: '时间' },
  },
  索引: [['last_maintained_at'], ['deleted_at'], ['parent_id'], ['level']],
};
