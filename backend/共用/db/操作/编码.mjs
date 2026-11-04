// 记录和数据库行之间的转换：列表、对象存成 JSON 文字，是否存成 0/1；读出来再转回去。
export function toRow(table, data) {
  const row = {};
  for (const [name, field] of Object.entries(table.字段)) row[name] = encodeValue(field, data[name]);
  return row;
}

export function encodeValue(field, value) {
  if (value === undefined || value === null) return null;
  if (field.类型 === '列表' || field.类型 === '对象') return JSON.stringify(value);
  if (field.类型 === '是否') return value ? 1 : 0;
  return value;
}

export function fromRow(table, row) {
  const data = {};
  for (const [name, field] of Object.entries(table.字段)) {
    const value = row[name];
    if (value === null || value === undefined) data[name] = null;
    else if (field.类型 === '列表' || field.类型 === '对象') data[name] = JSON.parse(value);
    else if (field.类型 === '是否') data[name] = value === 1;
    else data[name] = value;
  }
  return data;
}
