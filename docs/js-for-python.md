# 给 Python 使用者的 JavaScript 速查

项目主体是 JavaScript（`.mjs`、`.js`）和 TypeScript（`.ts`、`.tsx`，就是加了类型标注的 JavaScript）。
下面是项目里最常见的写法，左边 JavaScript，右边对应的 Python。例子大多摘自项目代码。

---

## 1. 变量

```js
const limit = 45;          // 不会再重新赋值
let count = 0;             // 之后会改
count += 1;
```
```python
limit = 45
count = 0
count += 1
```
`const` 只是说"这个名字不再指向别的东西"，对象里面的内容还是可以改的。

## 2. 函数与箭头函数

```js
function hostOf(url) {
  return new URL(url).hostname;
}
const isNotice = title => /通知|公告/.test(title);        // 箭头函数：参数 => 返回值
const add = (a, b) => a + b;
```
```python
def host_of(url):
    return urlparse(url).hostname

is_notice = lambda title: re.search(r'通知|公告', title) is not None
add = lambda a, b: a + b
```
箭头函数最常出现在 `map`、`filter` 的括号里（见第 4 条）。

## 3. 对象（相当于 dict）和取值

```js
const record = { id:'a', name:'某某大赛', schedule:{ registration_end:'2026-10-15' } };
record.name                               // '某某大赛'
record['name']                            // 同上
record.schedule?.registration_end         // ?. ：前面是空就返回 undefined，不报错
record.aiReview?.issues || []             // 取不到就用空列表
```
```python
record = {'id': 'a', 'name': '某某大赛', 'schedule': {'registration_end': '2026-10-15'}}
record['name']
record.get('schedule', {}).get('registration_end')
(record.get('aiReview') or {}).get('issues') or []
```
JavaScript 的 `null` 和 `undefined` 都相当于 Python 的 `None`（`undefined` 是"根本没这个键"）。

## 4. 列表操作：map / filter / find / some

这是项目里出现最多的写法。

```js
records.map(r => r.name)                          // 每条取名字
records.filter(r => r.dataStatus === 'published') // 只要已发布的
records.find(r => r.id === 'a')                   // 找第一条，找不到是 undefined
records.some(r => r.needsManualReview)            // 有没有任意一条
records.every(r => r.name)                        // 是不是每条都有
records.slice(0, 10)                              // 前 10 条
records.length                                    // 条数
```
```python
[r['name'] for r in records]
[r for r in records if r['dataStatus'] == 'published']
next((r for r in records if r['id'] == 'a'), None)
any(r.get('needsManualReview') for r in records)
all(r.get('name') for r in records)
records[0:10]
len(records)
```
连着写就是一条流水线：`records.filter(...).map(...).slice(0, 5)`，从左往右读。

## 5. 展开 `...`：复制并改几个字段

项目里改一条记录几乎都这么写——不在原对象上改，而是复制一份再覆盖：

```js
const next = { ...record, dataStatus:'archived', updatedAt:now };
const all = [...oldList, ...newList];
const { aiReviewFailure, ...rest } = record;      // 拿掉一个字段，剩下的放进 rest
```
```python
next_ = {**record, 'dataStatus': 'archived', 'updatedAt': now}
all_ = [*old_list, *new_list]
rest = {k: v for k, v in record.items() if k != 'aiReviewFailure'}
```

## 6. 解构：一次取出几个字段

```js
const { name, organizer } = record;
const [first, second] = list;
function run({ dryRun = false, limit = 45 } = {}) { ... }   // 带默认值的"关键字参数"
```
```python
name, organizer = record['name'], record['organizer']
first, second = list_[0], list_[1]
def run(dry_run=False, limit=45): ...
```

## 7. 字符串模板

```js
`报名截止 ${date} 已过`
`${a}：${b.slice(0, 60)}`
```
```python
f'报名截止 {date} 已过'
f'{a}：{b[:60]}'
```
注意是反引号 `` ` ``，不是普通引号。

## 8. 条件与比较

```js
a === b            // 相等（项目里一律用三个等号）
a !== b            // 不等
x ? '是' : '否'     // 三元
a || b             // a 为空就用 b
a ?? b             // 只有 a 是 null/undefined 才用 b（0 和 '' 不算空）
!value             // not value
```
```python
a == b
a != b
'是' if x else '否'
a or b
b if a is None else a
not value
```

## 9. 正则

```js
/通知|公告/.test(title)                       // 有没有匹配
title.replace(/\s+/g, ' ')                   // 全部替换（g = 全局）
const m = /(\d{4})年/.exec(text); m?.[1]      // 取分组
```
```python
re.search(r'通知|公告', title) is not None
re.sub(r'\s+', ' ', title)
m = re.search(r'(\d{4})年', text); m and m.group(1)
```

## 10. 循环

```js
for (const record of records) { ... }                  // 遍历元素
for (const [key, value] of Object.entries(obj)) { }   // 遍历字典
for (let i = 0; i < n; i += 1) { }
```
```python
for record in records: ...
for key, value in obj.items(): ...
for i in range(n): ...
```
注意 `for ... in` 在 JavaScript 里遍历的是**下标或键**，项目里基本只用 `for ... of`。

## 11. Map 和 Set

```js
const byId = new Map(records.map(r => [r.id, r]));
byId.get('a'); byId.has('a'); byId.set('b', x);
const seen = new Set(); seen.add(url); seen.has(url);
```
```python
by_id = {r['id']: r for r in records}
by_id.get('a'); 'a' in by_id; by_id['b'] = x
seen = set(); seen.add(url); url in seen
```

## 12. 异步：async / await

访问网页、调 AI、调后端接口都要等，所以函数前面常有 `async`，调用时加 `await`：

```js
async function main() {
  const response = await fetch(url);
  const html = await response.text();
}
const results = await Promise.all(urls.map(u => fetchOne(u)));   // 同时发多个请求
```
```python
async def main():
    async with session.get(url) as response:
        html = await response.text()

results = await asyncio.gather(*(fetch_one(u) for u in urls))
```
看代码时可以先把 `await` 当作"等它做完再往下走"，和普通同步代码一样顺着读。

## 13. 出错处理

```js
try {
  data = JSON.parse(text);
} catch (error) {
  console.log(error.message);
}
throw new Error('发布前必须找到官方来源');
```
```python
try:
    data = json.loads(text)
except Exception as error:
    print(error)
raise Exception('发布前必须找到官方来源')
```

## 14. 读写文件和 JSON

```js
import fs from 'node:fs';
const plan = JSON.parse(fs.readFileSync('plans/x.json', 'utf8'));
fs.writeFileSync('out.json', JSON.stringify(data, null, 2));
```
```python
import json
plan = json.load(open('plans/x.json', encoding='utf-8'))
json.dump(data, open('out.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
```

## 15. 导入和导出

项目里有两种写法，意思一样：

```js
// .mjs 文件（新写法）
import { normalizeName } from './search-plan.mjs';
export function watchPages(records) { ... }

// .js 文件（云函数里的老写法）
const { isolateMisimport } = require('./quarantine');
module.exports = { isolateMisimport };
```
```python
from search_plan import normalize_name
# Python 不需要显式导出，模块里定义的函数都能被导入
```

## 16. 调后端接口（脚本里最常见）

服务器上的脚本都是这样读写赛事库的：

```js
const response = await fetch('http://127.0.0.1:8787/api/adminData', {
  method:'POST',
  headers:{ 'content-type':'application/json' },
  body:JSON.stringify({ adminToken:token, action:'bootstrap' }),
});
const result = await response.json();
const records = result.data.records;
```
```python
import requests
result = requests.post('http://127.0.0.1:8787/api/adminData',
                       json={'adminToken': token, 'action': 'bootstrap'}).json()
records = result['data']['records']
```
写 Python 小工具时，这一段就是和主程序打交道的全部方式。

---

## 怎么读一个脚本

1. **先看文件开头的注释**：每个脚本开头都用中文写了它是干什么的、用法是什么。
2. **找 `main` 函数**：`async function main()` 是入口，文件最后一行一般是调用它的地方。
3. **跳过细节函数**：`main` 里调用的函数，看名字大致就知道做什么，需要时再点进去看。
4. **`--dry-run`**：大部分会写库的脚本都支持这个参数，只预演、不写入。

## 一个真实例子：对照着读

[quarantine.js](../apps/miniprogram/cloudfunctions/adminData/quarantine.js) 里判断要不要隔离的开头几行：

```js
function isolateMisimport(input, now = new Date().toISOString()) {
  if (input.dataStatus === 'quarantined') return input;
  const record = noteSourceQuality(input);
  const identityIssue = record.aiReview?.decision === 'needs_changes'
    && record.aiReview?.risk_level === 'high'
    && (record.aiReview.issues || []).find(issue => issue.field === 'event_identity');
  if (!titleReject && record.dataStatus === 'published') return flagPublishedIdentity(record, identityIssue, now);
```

换成 Python 大致是：

```python
def isolate_misimport(input_, now=None):
    now = now or datetime.utcnow().isoformat()
    if input_['dataStatus'] == 'quarantined':
        return input_
    record = note_source_quality(input_)
    review = record.get('aiReview') or {}
    identity_issue = (
        review.get('decision') == 'needs_changes'
        and review.get('risk_level') == 'high'
        and next((i for i in review.get('issues') or [] if i['field'] == 'event_identity'), None)
    )
    if not title_reject and record['dataStatus'] == 'published':
        return flag_published_identity(record, identity_issue, now)
```
