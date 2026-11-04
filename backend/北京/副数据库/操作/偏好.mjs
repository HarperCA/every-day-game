// 偏好：每个用户一条。选项 { now }。
//   保存(db, 用户id, { profession, categories, province, survey_status, dont_show_again }, 选项)   没有就建、有就改（建立时间不变）
//   读取(db, 用户id)                                                                             没有给 null
export function 保存(db, 用户id, { profession = null, categories = [], province = null, survey_status = 'completed', dont_show_again = false }, { now = new Date() } = {}) {
  const at = now.toISOString();
  const 内容 = { profession: profession || null, categories: categories || [], province: province || null, survey_status, dont_show_again: dont_show_again === true, updated_at: at };
  return db.transaction(tx => (tx.get('user_preference', 用户id)
    ? tx.update('user_preference', 用户id, 内容)
    : tx.insert('user_preference', 用户id, { ...内容, created_at: at })).data);
}

export const 读取 = (db, 用户id) => db.get('user_preference', 用户id)?.data ?? null;
