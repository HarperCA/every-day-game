// 用户（一级）：小程序账号，收藏、提醒、意见反馈、纠错、偏好都挂在它下面。字段沿用旧表 user_account；openid 唯一，同时首次登录只会留下一个账号。
export default {
  表名: 'user_account',
  说明: '小程序账号',
  主键: 'id',
  字段: {
    id: { 说明: '账号编号', 必填: true, 类型: '编号' },
    openid: { 说明: '微信 openid', 必填: true, 类型: '文字' },
    appid: { 说明: '小程序 appid', 必填: false, 类型: '文字' },
    unionid: { 说明: '微信 unionid', 必填: false, 类型: '文字' },
    status: { 说明: '账号状态', 必填: true, 类型: '文字', 可选值: ['active', 'disabled'], 默认: 'active' },
    created_at: { 说明: '注册时间', 必填: true, 类型: '时间' },
    updated_at: { 说明: '最后修改时间', 必填: false, 类型: '时间' },
    last_login_at: { 说明: '最后登录时间', 必填: false, 类型: '时间' },
    // 2026-11-09 加（组队里给队友看）：001 已部署不能改，写了 结构文件 的字段不进 001，在 004 里用 ALTER TABLE 加（见 结构/生成.mjs）
    nickname: { 说明: '昵称（用户自己填，组队里给队友看）', 必填: false, 类型: '文字', 最长: 30, 结构文件: '004-用户昵称头像.sql' },
    avatar_url: { 说明: '头像网址（只收 https，服务里查）', 必填: false, 类型: '网址', 最长: 500, 结构文件: '004-用户昵称头像.sql' },
  },
  唯一: [['openid']],
  索引: [],
};
