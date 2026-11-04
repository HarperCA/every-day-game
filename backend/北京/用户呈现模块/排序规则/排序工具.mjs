// 排序工具：调数据库工具取条目和这个用户的标记，按面板条件筛，再交给排序规则排。
//   排序(条件, { 主库, 副库, 用户id, now }) → { 条目们, 搜到的专业 }
//     条目：主数据库的 公开.全部条目（每一届和它的比赛合成一条）
//     收藏、提醒（规则 ④）：登录了从副数据库读——收藏的比赛编号；已授权、还没发（待发送或排队中）的提醒的届次编号；
//                          没登录用手机带来的（和旧版一样）
import { 公开 } from '../../主数据库/index.mjs';
import { 收藏, 提醒 } from '../../副数据库/index.mjs';
import { 面板筛选 } from '../用户输入/index.mjs';
import { 按规则排 } from './排序规则.mjs';

function 用户标记(副库, 用户id) {
  const 有效提醒 = 提醒.列出(副库, 用户id)
    .filter(r => r.authorization_status === 'accepted' && (r.delivery_status === 'pending' || r.delivery_status === 'queued'))
    .map(r => r.edition_id);
  return { 收藏: 收藏.编号们(副库, 用户id), 提醒: [...new Set(有效提醒)] };
}

export function 排序(条件, { 主库, 副库, 用户id = null, now = new Date() }) {
  const 条目们 = 公开.全部条目(主库).filter(item => 面板筛选(item, 条件, now));
  const 标记 = 用户id ? 用户标记(副库, 用户id) : { 收藏: 条件.收藏, 提醒: 条件.提醒 };
  return 按规则排(条目们, {
    关键词: 条件.关键词, 专业们: 条件.专业们, 省份: 条件.省份, 列表分组: 条件.列表分组, 专业: 条件.面板.专业, ...标记,
  }, now);
}
