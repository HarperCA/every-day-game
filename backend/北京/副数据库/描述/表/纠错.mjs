// 纠错：用户指出某一届的信息有错。字段沿用旧的上海 feedback 集合里用户提交的部分（database/schemas/feedback.schema.json）；
// AI 审核、人工抽查的字段在美国（同步过去审），这里只存提交内容和处理状态。届次在主数据库，写“对应”。
export default {
  表名: 'feedback',
  说明: '纠错',
  主键: 'id',
  字段: {
    id: { 说明: '纠错编号', 必填: true, 类型: '编号' },
    user_id: { 说明: '谁提交的', 必填: true, 类型: '编号', 指向: 'user_account' },
    edition_id: { 说明: '针对哪一届', 必填: true, 类型: '编号', 对应: 'edition' },
    competition_name: { 说明: '比赛名称（提交时的）', 必填: true, 类型: '文字', 最长: 200 },
    category: { 说明: '哪方面有错', 必填: true, 类型: '文字', 可选值: ['time', 'registration_link', 'eligibility', 'rules', 'other'] },
    content: { 说明: '内容', 必填: true, 类型: '长文字', 最长: 2000 },
    evidence_url: { 说明: '依据的网址（选填）', 必填: false, 类型: '网址' },
    status: { 说明: '处理状态', 必填: true, 类型: '文字', 可选值: ['pending_ai_review', 'ai_queued', 'ai_passed', 'ai_flagged', 'human_reviewing', 'accepted', 'rejected'], 默认: 'pending_ai_review' },
    created_at: { 说明: '提交时间', 必填: true, 类型: '时间' },
    updated_at: { 说明: '最后修改时间', 必填: true, 类型: '时间' },
    resolved_at: { 说明: '处理完的时间', 必填: false, 类型: '时间' },
  },
  索引: [['user_id'], ['status'], ['edition_id']],
};
