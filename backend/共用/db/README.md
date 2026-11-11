# 数据库读写方法（backend/共用/db）

美国比赛库、北京用户库共用的一套读写方法。这里不认识任何具体的表：用哪些表、建表语句在哪，由 `美国/db/index.mjs`、`北京/主数据库/index.mjs`、`北京/副数据库/index.mjs` 传进来。

```
共用/db/
  index.mjs        唯一入口：openDb、buildCreateSql、FIELD_TYPES、LIMITS、DbError、validate、RAW
  字段类型.mjs      允许的字段类型；长度上限的几档（两边的表描述都用）
  操作/            打开库、读、筛选、写、校验、编码、统一报错
  结构/            按表的描述生成建表语句；打开库时补执行没执行过的编号文件
  test/            用临时的表测打开、升级、只读，不依赖任何一边的表
```

## 接口

```js
openDb({ file, tables, structureDir, readOnly })   // 三个都要给，一般经 美国/db、北京/主数据库、北京/副数据库 的入口打开
db.get / db.list / db.find / db.count              // 读、筛选（条件写法见 操作/筛选.mjs）
db.insert / db.update / db.remove / db.transaction // 写：写前按描述校验，有版本号的表修改要带版本号
```

- `readOnly: true`：另一台服务器同步过来的副本用它打开，任何写入都报“只读副本”。
- 报错一律是 `DbError`，按 kind 区分：校验不通过、版本冲突、找不到、已存在、指向的记录不存在、不能删除、只读副本、请求有误。
- 表描述里的“指向”由数据库检查（同一个库）；“对应”是跨库的引用，数据库不查，由用到的地方核对。
