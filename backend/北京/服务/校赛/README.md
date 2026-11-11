# 校赛（北京/服务/校赛）

2026-11-08 粗版本，先跑通，后续再细化。

流程：老师或学生组织申请当某个学校的校赛管理员 → 同步到美国后台审核 → 通过后生成邀请码，小程序拼成链接或转发卡片发给本校学生 → 学生点开、填姓名、学院、专业、学号，立刻成为该校学生 → 管理员发布校赛 → 同步到美国审核 → 审核发布后，只有本校的学生和管理员在小程序里看得到。

```
校赛/
  index.mjs    handle：按 action 分给下面的动作，输入校验、权限检查、换成小程序字段
  test/单独/   从申请到本校看到的整条流程（美国审核用副数据库的 处理管理员申请、处理校赛 模拟）
```

存取在副数据库：`北京/副数据库/操作/校赛.mjs`，四张表的描述在 `北京/副数据库/描述/表/校赛*.mjs`，建表语句 `北京/副数据库/结构/003-校赛.sql`。

## 请求和回复

小程序 `POST /api/school`，要令牌（同 /api/userData）。请求 `{ action, ...参数, userSessionToken }`，回复 `{ ok: true, data }` 或 `{ ok: false, message }`。

| action | 参数 | 交回 data | 谁能做 |
|---|---|---|---|
| applyAdmin | school、realName、contact、proof | { application } 待审核 | 登录用户；同一学校待审核、已通过的不能重复申请（school_admin_already_applied），被拒的可以再申请 |
| myStatus | — | { adminSchools: [学校名], applications: [申请], memberships: [学生信息] } | 登录用户 |
| createInvite | school | { inviteCode, school }：有没作废的就交回同一个 | 本校已通过的管理员 |
| renewInvite | school | { inviteCode, school }：旧的作废 | 本校已通过的管理员 |
| listMembers | school | { items: [学生信息], total } | 本校已通过的管理员 |
| removeMember | school、memberId | { removed: 0 或 1 } | 本校已通过的管理员 |
| publishContest | school、title、content、signup?、startDate?、endDate?（YYYY-MM-DD） | { contest } 待审核 | 本校已通过的管理员 |
| myContests | school | { items: [校赛，含 status、reviewNote] } 本校全部 | 本校已通过的管理员 |
| withdrawContest | contestId | { contest } 已下架 | 这个校赛所在学校的已通过管理员 |
| joinSchool | inviteCode、realName、college、major、studentNo（都必填） | { membership } | 登录用户；邀请码作废、发邀请的人不再是管理员都报 invite_invalid；同一学校再加入就更新信息 |
| leaveSchool | school | { left: 删了几行 } | 登录用户 |
| listSchoolContests | — | { items: [校赛] }：所在学校（学生或管理员）里已发布的 | 登录用户 |

字段：申请 { id, school, realName, contact, proof, status, reviewNote, createdAt, updatedAt }；学生信息 { id, school, realName, college, major, studentNo, joinedAt }；
校赛（管理员看）{ id, school, title, content, signup, startDate, endDate, status, reviewNote, createdAt, updatedAt }，学生看的不带 status、reviewNote、时间。

报错：unauthenticated、user_account_disabled、unsupported_action、not_school_admin、invite_invalid、school_admin_already_applied、school_contest_not_found、
invalid_<字段>（没填或格式不对，如 invalid_student_no、invalid_start_date）、<字段>_too_long、invalid_date_range（结束早于开始）；数据库校验没过回 school_failed。

长度上限（字）：学校 100、姓名 50、联系方式 100、证明说明 1000、学院 100、专业 100、学号 40、标题 100、简介 2000、报名方式 500。

## 和美国审核的接口

- 表名、字段名（school_admin、school_contest 等）是和美国的接口，不要改。管理员申请、校赛同步到美国审核，由 `沟通/` 负责（另一处写）。
- 美国审核完经 `沟通/审核结果回传` 调副数据库的：
  - `校赛.处理管理员申请(db, 编号, { status, review_note }, { 读到的更新时间, now })` → 改好的那一行；status 只能 已通过、已拒绝；
  - `校赛.处理校赛(db, 编号, { status, review_note }, { 读到的更新时间, now })` → 改好的那一行；status 只能 已发布、已拒绝、已下架。
  - 读到的更新时间对不上抛 `feedback_conflict`，找不到抛 `feedback_not_found`（和 纠错.处理 一样，回传那边照样回 409、404）；status 不对抛 invalid_school_admin_status、invalid_school_contest_status。

## 个人信息

- 学生的姓名、学院、专业、学号只有本校已通过的管理员能看（listMembers）；学生自己在 myStatus 里看自己的。
- 学生退出（leaveSchool）或被移出（removeMember）就删掉这一行，不留。注销账号时申请、学生信息、邀请、发的校赛跟着删（指向 user_account 连带删）。
- 学生名单（school_member）不传美国：用户数据同步只推 `沟通/用户数据同步/格式.mjs` 白名单里的表，不要把 school_member 加进去。

## 待办（以后优化）

- 内容安全检查：申请、校赛标题和简介提交前过微信 msgSecCheck。
- 审核结果通知：管理员申请、校赛审核完发订阅消息。
- 学校名现在是自由填写的文字，同一学校可能写法不同；以后改成选学校（学校表或编码）。
- 管理员发布频率限制、每校邀请码数量限制；邀请码过期时间。
- 校赛编辑（现在只能发布、下架；改内容要重新审核的规则没定）。
- 管理员被撤销（美国把已通过改回已拒绝）后，他发的邀请自动失效已做（加入时检查），已加入的学生、已发布的校赛怎么处理没定。
- 校赛列表分页、按开始日期排序。
