// 用户呈现模块：用户查找和调取比赛的逻辑（小程序首页列表）。外面只经这个入口用（服务/公开数据 调它）。
//   呈现首页(请求, { 主库, 副库, 用户id, now })   见 呈现调度.mjs
export { 呈现首页 } from './呈现调度.mjs';
//   信息来源(条目) → { infoSource: 'official' | 'school_repost', infoSourceUrl }   详情页也用（服务/公开数据）
export { 信息来源 } from './返回/index.mjs';
