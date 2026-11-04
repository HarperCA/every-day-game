// 主数据库的读取工具。只读，不做业务判断（筛选、排序在 用户呈现模块/）。
//   全部条目(db)            每一届和它的比赛合成一条：{ 比赛的公开内容, 届次的公开内容, id（届次编号）, competition_id, name, level, organizer, 报名时间, status }
//                           级别、主办方届次没填的用比赛的
//   届次(db, id)            一届合成的一条；没有给 null
//   比赛(db, id)            { id, name, level, 其余公开内容 }；没有给 null
//   比赛的届次(db, id)       这个比赛的每一届（合成的条目）
function 合成(比赛, 届次) {
  return {
    ...比赛.data, ...届次.data,
    id: 届次.id, competition_id: 比赛.id, name: 比赛.name,
    level: 届次.data.level ?? 比赛.level ?? null,
    organizer: 届次.data.organizer ?? 比赛.data.organizer ?? null,
    registration_start: 届次.registration_start, registration_end: 届次.registration_end, status: 届次.status,
  };
}

export function 全部条目(db) {
  const 比赛们 = new Map(db.find('public_competition', {}).map(c => [c.id, c]));
  return db.find('public_edition', {}, { orderBy: 'id' }).map(e => 合成(比赛们.get(e.competition_id), e));
}

export function 届次(db, id) {
  const e = db.get('public_edition', id)?.data;
  return e ? 合成(db.get('public_competition', e.competition_id).data, e) : null;
}

export function 比赛(db, id) {
  const c = db.get('public_competition', id)?.data;
  return c ? { ...c.data, id: c.id, name: c.name, level: c.level } : null;
}

export function 比赛的届次(db, id) {
  const c = db.get('public_competition', id)?.data;
  return c ? db.find('public_edition', { competition_id: id }, { orderBy: 'id' }).map(e => 合成(c, e)) : [];
}
