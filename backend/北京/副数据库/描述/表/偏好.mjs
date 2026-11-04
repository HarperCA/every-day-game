// 偏好：首次打开的问卷（专业、关心的比赛大类、省份），每个用户一条，换手机登录能带上。字段沿用旧的上海 user_preference 集合。
// 首页排序用它（用户呈现模块：专业大类、省份筛选，综合分里的专业匹配）。
export default {
  表名: 'user_preference',
  说明: '偏好',
  主键: 'user_id',
  字段: {
    user_id: { 说明: '谁的偏好', 必填: true, 类型: '编号', 指向: 'user_account' },
    profession: { 说明: '专业大类', 必填: false, 类型: '文字' },
    categories: { 说明: '关心的比赛大类', 必填: false, 类型: '列表' },
    province: { 说明: '省份', 必填: false, 类型: '文字' },
    survey_status: { 说明: '问卷填了还是跳过', 必填: true, 类型: '文字', 可选值: ['completed', 'skipped'], 默认: 'completed' },
    dont_show_again: { 说明: '不再弹问卷', 必填: true, 类型: '是否', 默认: false },
    created_at: { 说明: '建立时间', 必填: true, 类型: '时间' },
    updated_at: { 说明: '最后修改时间', 必填: true, 类型: '时间' },
  },
  索引: [],
};
