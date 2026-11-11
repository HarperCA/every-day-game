// 来源：届次里的信息出自哪个网址、原文怎么写的。一个届次可以有多条（线上 343 届共 652 条）。
// 旧记录里是每届的 sources 数组，建库时拆成一行一条。
import { LIMITS } from '../../../../../共用/db/字段类型.mjs';

export default {
  表名: 'source',
  说明: '信息来源',
  主键: 'id',
  字段: {
    id: { 说明: '来源编号，沿用旧的 id', 必填: true, 类型: '编号', 旧: 'id' },
    edition_id: { 说明: '属于哪个届次', 必填: true, 类型: '编号', 指向: 'edition', 旧: 'edition_id' },
    url: { 说明: '网址', 必填: true, 类型: '网址', 最长: LIMITS.网址, 旧: 'url' },
    final_url: { 说明: '跳转后的最终网址', 必填: false, 类型: '网址', 最长: LIMITS.网址, 旧: 'final_url' },
    // 旧数据里有 20 种写法（official_website、organizer_website、organizer_official_website……），
    // 建库时归并成下面几类；可选值等你定。
    source_type: { 说明: '来源种类', 必填: true, 类型: '文字', 可选值: null, 旧: 'source_type' },
    is_official: { 说明: '是不是官方来源', 必填: true, 类型: '是否', 默认: false, 旧: 'is_official' },
    validity_status: { 说明: '核验结果', 必填: true, 类型: '文字', 可选值: ['unchecked', 'valid', 'valid_auxiliary', 'valid_as_lead', 'invalid', 'content_unavailable'], 默认: 'unchecked', 旧: 'validity_status' },
    title: { 说明: '网页标题', 必填: false, 类型: '文字', 最长: LIMITS.短, 旧: 'title' },
    published_at: { 说明: '发布日期（原文只写到月或年的就存到月或年）', 必填: false, 类型: '不完整日期', 旧: 'published_at' },
    content_summary: { 说明: '内容摘要', 必填: false, 类型: '长文字', 最长: LIMITS.中, 旧: 'content_summary' },
    supports_fields: { 说明: '这条来源支撑了哪些字段', 必填: false, 类型: '列表', 旧: 'supports_fields' },
    review_reason: { 说明: '核验说明', 必填: false, 类型: '文字', 最长: LIMITS.中, 旧: 'review_reason' },
    evidence_excerpt: { 说明: '原文摘录', 必填: false, 类型: '长文字', 最长: LIMITS.摘录, 旧: 'evidence_excerpt' },
    last_verified_at: { 说明: '最近核对时间', 必填: false, 类型: '时间', 旧: 'last_verified_at' },
  },
  索引: [['edition_id'], ['url']],
};
