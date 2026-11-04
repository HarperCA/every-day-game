// 用户副本的唯一一张表：北京用户库（和报错库）每张表的每一行在这里存一行，按“表:编号”找。
// 不照抄北京的表结构：北京改了表美国不用跟着改，后台按表读出来自己整理。可选的表和 沟通/用户数据同步/格式.mjs 的 同步的表 一致。
export const 同步来的表 = ['user_account', 'favorite', 'reminder', 'general_feedback', 'feedback', 'user_preference', 'client_stats', 'client_issues'];

export default {
  表名: 'beijing_copy',
  说明: '北京用户数据的只读副本',
  主键: 'id',
  字段: {
    id: { 说明: '表名:编号', 必填: true, 类型: '编号' },
    table_name: { 说明: '北京的哪张表', 必填: true, 类型: '文字', 可选值: 同步来的表 },
    row_id: { 说明: '北京那张表里的编号', 必填: true, 类型: '文字' },
    data: { 说明: '这一行的内容（账号去掉了 openid、appid、unionid）', 必填: true, 类型: '对象' },
    round: { 说明: '整体重推的轮次：收尾时这一轮没写到的清掉', 必填: false, 类型: '文字' },
    synced_at: { 说明: '最后一次同步过来的时间', 必填: true, 类型: '时间' },
  },
  索引: [['table_name']],
};
