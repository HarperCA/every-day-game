// 后台的操作记录：谁在什么时候改了哪条。字段沿用旧表 audit_log。
export default {
  表名: 'audit_log',
  说明: '后台操作记录',
  主键: 'id',
  字段: {
    id: { 说明: '记录编号', 必填: true, 类型: '编号' },
    created_at: { 说明: '操作时间', 必填: true, 类型: '时间' },
    action: { 说明: '做了什么', 必填: true, 类型: '文字', 可选值: null },
    table_name: { 说明: '改的哪张表', 必填: false, 类型: '文字' },
    record_id: { 说明: '改的哪条', 必填: false, 类型: '编号' },
    detail: { 说明: '改动内容', 必填: false, 类型: '对象' },
  },
  索引: [['created_at'], ['record_id']],
};
