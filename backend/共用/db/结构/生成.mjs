// 按表的描述生成建表语句，美国、北京共用。各自的 结构/生成.mjs 传自己的表进来，写成自己的 001-建表.sql。

// 列表、对象存成 JSON 文字；是否存成 0/1
const SQL_TYPE = { 整数: 'INTEGER', 时间戳: 'INTEGER', 是否: 'INTEGER' };

function createTable(table, tables) {
  const lines = Object.entries(table.字段).map(([name, field]) => {
    let line = `  ${name} ${SQL_TYPE[field.类型] || 'TEXT'}`;
    if (name === table.主键) line += ' PRIMARY KEY';
    else if (field.必填) line += ' NOT NULL';
    // 推迟到事务提交时再检查，一个事务里先插届次、后插比赛也可以
    if (field.指向) line += ` REFERENCES ${field.指向}(${tables[field.指向].主键}) DEFERRABLE INITIALLY DEFERRED`;
    return line;
  });
  for (const cols of table.唯一 || []) lines.push(`  UNIQUE (${cols.join(', ')})`);
  const indexes = (table.索引 || []).map(cols =>
    `CREATE INDEX idx_${table.表名}_${cols.join('_')} ON ${table.表名}(${cols.join(', ')});`);
  return [`-- ${table.说明}`, `CREATE TABLE ${table.表名} (`, lines.join(',\n'), ');', ...indexes].join('\n');
}

export function buildCreateSql(tables) {
  const head = '-- 由 结构/生成.mjs 按 描述/ 生成，不要手改。上线后改表一律新增编号文件。';
  return [head, ...Object.values(tables).map(table => createTable(table, tables))].join('\n\n') + '\n';
}
