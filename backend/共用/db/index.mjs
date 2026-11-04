// 数据库通用部分的唯一入口，美国、北京都只经这里用。具体接口见 操作/index.mjs 和 README.md。
//   openDb({ file, tables, structureDir, readOnly })   打开一个库（由 美国/db、北京/主数据库、北京/副数据库 的入口传表和结构）
//   buildCreateSql(tables)                            按表的描述生成建表语句
//   FIELD_TYPES、LIMITS                               字段类型、长度上限的几档
//   DbError、DB_ERROR_KINDS、validate                 统一报错、写入前校验
//   RAW                                               只给各库自己的 操作/ 写连表查询用
export * from './操作/index.mjs';
export { FIELD_TYPES, LIMITS } from './字段类型.mjs';
export { buildCreateSql } from './结构/生成.mjs';
