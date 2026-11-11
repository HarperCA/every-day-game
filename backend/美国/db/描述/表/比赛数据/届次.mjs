// 二级：届次，挂在比赛下，放每届会变的信息。提醒挂在这里。
// 级别、主办方不填就用比赛的。旧记录里的 schedule、track 两个嵌套对象拆平成单独字段（旧：'schedule.xxx'）；
// recommendation 每届一份，结构由 AI 输出决定，整个存成对象。
// AI 过程（aiReview、aiResolution、fieldVerification 及失败记录）不放这里，放 处理记录.mjs。
import { LIMITS } from '../../../../../共用/db/字段类型.mjs';

const UNSET = '暂未明确';

export default {
  表名: 'edition',
  说明: '届次（二级）',
  主键: 'id',
  删除标记: 'deleted_at',
  字段: {
    // 身份
    id: { 说明: '届次编号，沿用旧记录的 id', 必填: true, 类型: '编号', 旧: 'id' },
    competition_id: { 说明: '属于哪个比赛', 必填: true, 类型: '编号', 指向: 'competition', 旧: 'eventId' },
    ordinal: { 说明: '在这个比赛里的顺序：1、2、3……，建库时按年份排', 必填: true, 类型: '整数' },
    edition_name: { 说明: '届次全称', 必填: true, 类型: '文字', 最长: LIMITS.短, 旧: 'editionName' },
    edition_year: { 说明: '年份，可能跨年，如“2025—2026”', 必填: false, 类型: '文字', 最长: 20, 旧: 'editionYear' },
    edition_ordinal: { 说明: '原文届次，如“第十七届”', 必填: false, 类型: '文字', 最长: 40, 旧: 'editionOrdinal' },
    level: { 说明: '级别；不填用比赛的', 必填: false, 类型: '文字', 可选值: ['国际级', '国家级', '省级/区域级', '其他/未明确'], 旧: 'eventLevel' },
    organizer: { 说明: '主办方；不填用比赛的', 必填: false, 类型: '文字', 最长: LIMITS.短, 旧: 'organizer' },

    // 参赛和报名
    participants: { 说明: '参赛对象', 必填: false, 类型: '长文字', 最长: LIMITS.中, 旧: 'participants' },
    eligibility: { 说明: '大学生参赛资格依据', 必填: false, 类型: '长文字', 最长: LIMITS.中, 旧: 'eligibility' },
    format_and_rules: { 说明: '赛制与规则（原文可能很长：传智杯赛道介绍最长 15079 字）', 必填: false, 类型: '长文字', 最长: LIMITS.摘录, 旧: 'formatAndRules' },
    participation_format: { 说明: '个人还是团队', 必填: true, 类型: '文字', 可选值: ['个人赛', '团队赛', '个人或团队均可', '暂未明确'], 默认: UNSET, 旧: 'participationFormat' },
    team_size: { 说明: '队伍人数原文', 必填: false, 类型: '文字', 最长: LIMITS.短, 旧: 'teamSize' },
    team_size_category: { 说明: '队伍人数分档', 必填: true, 类型: '文字', 可选值: ['1人', '2～3人', '4～5人', '6人及以上', '人数范围不固定', '暂未明确'], 默认: UNSET, 旧: 'teamSizeCategory' },
    registration_method: { 说明: '报名方式原文', 必填: false, 类型: '长文字', 最长: LIMITS.中, 旧: 'registrationMethod' },
    registration_organization: { 说明: '怎么报名', 必填: true, 类型: '文字', 可选值: ['自行报名', '学校统一报名', '两种方式均可', '需先校内选拔', '以赛区或学校通知为准', '暂未明确'], 默认: UNSET, 旧: 'registrationOrganization' },
    registration_url: { 说明: '报名入口', 必填: false, 类型: '网址', 最长: LIMITS.网址, 旧: 'registrationUrl' },
    fees: { 说明: '费用原文', 必填: false, 类型: '长文字', 最长: LIMITS.中, 旧: 'fees' },
    fee_type: { 说明: '费用分档', 必填: true, 类型: '文字', 可选值: ['免费', '收费', '不同赛项费用不同', '暂未公布'], 默认: '暂未公布', 旧: 'feeType' },

    // 时间（旧 schedule）
    registration_start: { 说明: '报名开始（原文只写日期的只存日期）', 必填: false, 类型: '日期或时间', 旧: 'schedule.registration_start' },
    registration_end: { 说明: '报名截止（原文只写日期的只存日期）', 必填: false, 类型: '日期或时间', 旧: 'schedule.registration_end' },
    competition_start: { 说明: '比赛开始（原文只写日期的只存日期）', 必填: false, 类型: '日期或时间', 旧: 'schedule.competition_start' },
    competition_end: { 说明: '比赛结束（原文只写日期的只存日期）', 必填: false, 类型: '日期或时间', 旧: 'schedule.competition_end' },
    pending_announcement: { 说明: '主办方明确说时间待公布', 必填: true, 类型: '是否', 默认: false, 旧: 'schedule.pending_announcement' },
    status_override: { 说明: '人工指定的报名状态', 必填: false, 类型: '文字', 可选值: ['报名中', '已截止', '时间待公布'], 旧: 'schedule.status_override' },
    status_override_reason: { 说明: '为什么人工指定', 必填: false, 类型: '文字', 最长: LIMITS.短, 旧: 'schedule.status_override_reason' },
    time_note: { 说明: '时间说明原文', 必填: false, 类型: '长文字', 最长: LIMITS.中, 旧: 'schedule.time_note' },

    // 赛道（旧 track，每届一个）
    track_name: { 说明: '赛道名称', 必填: false, 类型: '文字', 最长: LIMITS.短, 旧: 'track.name' },
    track_scope_note: { 说明: '赛道范围说明', 必填: false, 类型: '文字', 最长: LIMITS.短, 旧: 'track.scope_note' },

    // 回报和规模
    reward_amount: { 说明: '现金奖金总额（元）', 必填: false, 类型: '整数', 旧: 'rewardAmount' },
    reward_tier: { 说明: '奖金分档', 必填: false, 类型: '文字', 可选值: ['无现金奖励', '万元以下', '1万-10万', '10万-50万', '50万以上', '暂未公布'], 旧: 'rewardTier' },
    reward_highlights: { 说明: '非现金回报：保研加分、实习直通……', 必填: false, 类型: '列表', 可选值: ['保研考研加分', '实习或直通面试', '就业绿色通道', '创业扶持', '国际交流', '证书荣誉', '实物奖品', '现金奖金'], 旧: 'rewardHighlights' },
    rewards: { 说明: '奖励原文', 必填: false, 类型: '长文字', 最长: LIMITS.中, 旧: 'rewards' },
    participant_count: { 说明: '参赛规模数字', 必填: false, 类型: '整数', 旧: 'participantCount' },
    participant_unit: { 说明: '规模单位', 必填: false, 类型: '文字', 可选值: ['队', '人', '暂未公布'], 旧: 'participantUnit' },
    scale_tier: { 说明: '规模分档', 必填: false, 类型: '文字', 可选值: ['千人以下', '千人-1万', '1万-10万', '10万以上', '暂未公布'], 旧: 'scaleTier' },
    participant_scale: { 说明: '规模原文', 必填: false, 类型: '文字', 最长: LIMITS.短, 旧: 'participantScale' },

    // 推荐（每届一份，AI 给出、人工审核）
    recommendation: { 说明: '推荐结论、理由、适合谁、准备建议、缺的信息', 必填: false, 类型: '对象', 旧: 'recommendation' },

    // 状态（2026-10-31 用户定：只有三种，附理由；归档和下一届推算由程序自动做，不存）
    status: { 说明: '状态：已发布给学生看；已归档是报名截止后程序自动归的；待人工审核是机器拿不准、等人定的', 必填: true, 类型: '文字', 可选值: ['已发布', '已归档', '待人工审核'], 默认: '待人工审核' },
    status_reason: { 说明: '状态的理由，每条写明哪个字段、什么问题、依据或出处；待人工审核时一定要有', 必填: false, 类型: '列表' },
    status_at: { 说明: '状态改成现在这样的时间（发布、归档、转人工的时间；后台按它排待审核等了多久）', 必填: false, 类型: '时间' },
    next_edition_estimate: { 说明: '下一届大概什么时候报名：每日归档时按这一届报名开始（没有就用比赛开始）往后推一年算的，只是参考、不是官方信息（2026-11-03 加，结构/002）', 必填: false, 类型: '时间' },
    last_verified_at: { 说明: '最近一次核对来源的时间（维护据此决定先查哪些）', 必填: false, 类型: '时间', 旧: 'lastVerifiedAt' },
    manual_fields: { 说明: '人工改过的字段：机器发现这些字段有问题时不自己改，只标待人工审核', 必填: false, 类型: '列表' },
    legacy: { 说明: '旧记录里新结构没有单独字段的内容，原样保留（旧的审核字段、追溯任务状态、分诊、隔离记录等），保证搬库不丢', 必填: false, 类型: '对象',
      旧: 'task / triage / enumNormalization / regionBasis / staleDraftReason / aiAutoPublishNote / reviewedAt / quarantine / quarantineResolution / restoredFrom / dataStatus / systemValidation / systemReviewIssues / systemReviewedAt / manualReview / manualReviewOverride / manualReviewReason / manualReviewedAt / manualReviewedBy / needsManualReview / qualityIssues / supersededBy / archivedAt / archivedReason / nextEditionEstimate / nextEditionEndEstimate / nextEditionBasis / publishedAt / firstSeenAt / admissionVerdict / curationBatch / curationListItem / ruleVersion / verifiedBy' },

    // 怎么发现的
    discovery: { 说明: '哪条路线、哪个查询词、哪个网址带来的', 必填: false, 类型: '对象', 旧: 'discovery' },
    discovery_notice_url: { 说明: '发现线索的通知网址', 必填: false, 类型: '网址', 最长: LIMITS.网址, 旧: 'discoveryNoticeUrl' },
    notice_resolution: { 说明: '从通知追到比赛页的结果', 必填: false, 类型: '对象', 旧: 'noticeResolution' },

    // 海报
    poster: { 说明: '海报：图片总库里的文件名、来源、来源网址、更新时间', 必填: false, 类型: '对象', 旧: 'poster' },
    poster_candidates: { 说明: '不是 16:9 的候选图，不给学生看', 必填: false, 类型: '对象', 旧: 'posterCandidates' },

    // 记录
    version: { 说明: '版本号，每改一次加一', 必填: true, 类型: '整数' },
    created_at: { 说明: '建立时间', 必填: true, 类型: '时间', 旧: 'createdAt' },
    created_by: { 说明: '谁建的（后台手工、流程……）', 必填: false, 类型: '文字', 最长: 40, 旧: 'createdBy' },
    updated_at: { 说明: '最后修改时间', 必填: true, 类型: '时间', 旧: 'updatedAt' },
    updated_by: { 说明: '最后谁改的', 必填: false, 类型: '文字', 最长: 40, 旧: 'updatedBy' },
    deleted_at: { 说明: '标记删除的时间；有值就算已删除，30 天后真删（删比赛时它的届次一起标）', 必填: false, 类型: '时间' },
    deleted_by: { 说明: '谁标记删除的', 必填: false, 类型: '文字', 最长: 80 },
  },
  唯一: [['competition_id', 'ordinal']],
  索引: [['competition_id'], ['registration_end'], ['status'], ['deleted_at']],
};
