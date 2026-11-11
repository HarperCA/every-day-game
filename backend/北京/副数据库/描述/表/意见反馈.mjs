// 意见反馈：用户对小程序本身的意见（不针对某场比赛）。字段沿用旧的上海 general_feedback 集合（database/schemas/general_feedback.schema.json）。
// public_reply 是给用户看的回复，internal_note 是后台内部备注（不给用户看）。
export default {
  表名: 'general_feedback',
  说明: '意见反馈',
  主键: 'id',
  字段: {
    id: { 说明: '意见反馈编号', 必填: true, 类型: '编号' },
    user_id: { 说明: '谁提交的', 必填: true, 类型: '编号', 指向: 'user_account' },
    type: { 说明: '哪一类', 必填: true, 类型: '文字', 可选值: ['bug', 'suggestion', 'data', 'other'], 默认: 'other' },
    content: { 说明: '内容', 必填: true, 类型: '长文字', 最长: 2000 },
    contact: { 说明: '联系方式（选填）', 必填: false, 类型: '文字', 最长: 200 },
    app_version: { 说明: '小程序版本', 必填: false, 类型: '文字', 最长: 40 },
    status: { 说明: '处理状态', 必填: true, 类型: '文字', 可选值: ['pending', 'processing', 'resolved'], 默认: 'pending' },
    public_reply: { 说明: '给用户的回复', 必填: false, 类型: '长文字', 最长: 2000 },
    internal_note: { 说明: '后台内部备注', 必填: false, 类型: '长文字', 最长: 2000 },
    created_at: { 说明: '提交时间', 必填: true, 类型: '时间' },
    updated_at: { 说明: '最后修改时间', 必填: true, 类型: '时间' },
    resolved_at: { 说明: '处理完的时间', 必填: false, 类型: '时间' },
  },
  索引: [['user_id'], ['status']],
};
