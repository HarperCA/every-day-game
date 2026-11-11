// 收藏只存比赛编号（收藏挂比赛；旧的上海 favorite 挂届次，迁移时改挂比赛，同一人收藏同一比赛的多届合成一条）。
// 比赛在主数据库，跨库查不了，所以 competition_id 写“对应”不写“指向”：由服务对照主数据库核对。
export default {
  表名: 'favorite',
  说明: '收藏',
  主键: 'id',
  字段: {
    id: { 说明: '收藏编号', 必填: true, 类型: '编号' },
    user_id: { 说明: '谁收藏的', 必填: true, 类型: '编号', 指向: 'user_account' },
    competition_id: { 说明: '收藏了哪个比赛', 必填: true, 类型: '编号', 对应: 'competition' },
    created_at: { 说明: '收藏时间', 必填: true, 类型: '时间' },
  },
  唯一: [['user_id', 'competition_id']],
  索引: [['user_id']],
};
