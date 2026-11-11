// 后台状态：后台要存的整份设置，一份一行（编号就是这份设置的名字），内容整块存成对象。
// 沿用旧系统的 admin_state 集合：现在有 site_blocklist（百度搜索的屏蔽网站名单，见 操作/屏蔽网站.mjs，2026-11-02）、ai_maintenance_queue（后台多选的 AI 维护队列，见 操作/维护队列.mjs，2026-11-06）。
export default {
  表名: 'admin_state',
  说明: '后台状态',
  主键: 'id',
  字段: {
    id: { 说明: '哪一份设置（site_blocklist、ai_maintenance_queue）', 必填: true, 类型: '编号' },
    data: { 说明: '设置的内容', 必填: true, 类型: '对象' },
    updated_at: { 说明: '最后改的时间', 必填: true, 类型: '时间' },
  },
  索引: [],
};
