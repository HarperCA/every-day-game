// 只给 操作/ 里的文件用：从打开的库上取出底层 SQLite 连接，写按表的复杂查询（例如届次和比赛连表）。
// 这个文件不经 db/index.mjs 导出，外面拿不到。
export const RAW = Symbol('sqlite');
