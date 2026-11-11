# 组队（北京/服务/组队）

小程序“私下组队”的后端（2026-11-08 粗版本；2026-11-09 按用户定的规则改）。比赛里建队 → 转发卡片 → 别人点卡片发申请（专业、年级必填）→ 给队长发订阅消息 → 队长通过/拒绝 → 通过即入队。

- **入口**：`POST /api/team`，要令牌（同 `/api/userData`）。
- **读写的数据**：副数据库 team（队伍）、team_member（队员）、team_application（组队申请）、team_notify_quota（组队通知次数），建表在 `副数据库/结构/002-组队.sql`（**还没部署到任何服务器**）；user_account 的昵称、头像（`004-用户昵称头像.sql`）；主数据库只读，核对比赛在不在、取比赛名。
- **不同步到美国**：组队四张表只在北京，`沟通/用户数据同步` 不带它们；账号的昵称、头像同步时也去掉（`格式.mjs`）。
- **现在的状态**：能用，有测试（`test/单独/组队.test.mjs`）。

## 11-09 定的规则

1. 去掉队员意见：没有 reviewApplication，申请表没有 reviews；只有队长审申请。
2. 申请：专业、年级必填，介绍、擅长方向选填；队长在待审列表里看得到这些和申请人的昵称头像。
3. 队长能改队名、改人数（2–15，不能小于现在的人数）、转让队长、踢人（不能踢自己）。
4. 队伍一直保留，队长手动解散；解散直接删掉队伍、队员、申请，不留“已解散”。
5. 队员看得到队友和队长的昵称、头像；非队员看不到队员信息。
6. 有人申请时给队长发订阅消息（见下面）。

## 动作

请求 `{ action, ...参数 }`，回复 `{ ok: true, data }` 或 `{ ok: false, message }`。

| action | 参数 | data | 谁能做 |
|---|---|---|---|
| createTeam | competitionId, maxMembers（2–15 的整数）, wechat, name? | { team } | 任何人；比赛要在主数据库 |
| getTeam | teamId | { team } | 任何人；非队员看简版（转发卡片落地用） |
| listMyTeams | | { teams } | 我参加的（含当队长的） |
| applyToTeam | teamId, major, grade, intro?, strengths? | { application } | 非队员；队伍没满、我没有待审的申请。成功后给队长发订阅消息，发不发、发没发成都不影响申请 |
| withdrawApplication | applicationId | { application } | 申请人，只能撤待审的 |
| listMyApplications | | { items }（申请 + team 简版） | 申请人；队伍解散后申请跟着删，不再出现 |
| listPendingForMe | | { items: [{ team, application }] } | **只有队长**：本队全部待审（application 带 applicant 昵称头像）；不是队长的队不出现，**队员调用交回 `{ items: [] }`**（不报错，小程序可以照常调） |
| decideApplication | applicationId, decision（approve / reject） | { application, team } | 只有队长；满员不能通过 |
| renameTeam | teamId, name | { team } | 只有队长；name 给空字符串清掉 |
| setMaxMembers | teamId, maxMembers（2–15 的整数） | { team } | 只有队长；小于现在的人数回 `max_members_below_current` |
| setWechat | teamId, wechat | { team } | 只有队长；转让后新队长补微信号用，也能改 |
| transferCaptain | teamId, userId（新队长的账号编号，取自 team.members） | { team }（按原队长的视角） | 只有队长；只能转给本队队员；原队长变队员；**队长微信号清空**（见下） |
| removeMember | teamId, userId | { team } | 只有队长；不能踢自己（`cannot_remove_self`）；被踢的人可以重新申请 |
| disbandTeam | teamId | { disbanded: true } | 只有队长；队伍、队员、申请都删掉，之后查这个队回 `team_not_found` |
| leaveTeam | teamId | { left: true } | 队员；队长要退请先转让或解散 |
| addSubscribeQuota | | { quota } | 任何人；小程序 `wx.requestSubscribeMessage` 用户接受后调一次，记一次可发次数，上限 50 |
| getSubscribeQuota | | { quota, templateId } | 任何人；templateId 没配是 null，小程序据此决定要不要弹订阅 |

昵称、头像的上传在用户数据服务：`POST /api/userData` 的 `getProfile {}`、`saveProfile { nickname?, avatarUrl? }` → `{ nickname, avatarUrl }`（只改给了的那一项，空字符串清掉；昵称最多 30 字；头像只收 https 网址、最长 500）。

- **team**：`{ id, competitionId, competitionName, name, maxMembers, memberCount, createdAt, isMember, isLeader }`；队员另外有 `version, wechat, members: [{ userId, role(leader/member), joinedAt, isMe, nickname, avatarUrl }]`（队长排第一，其余按加入先后；没填的昵称头像是空字符串）。11-09 去掉了 `status`。
- **application**：`{ id, teamId, applicantId, major, grade, intro, strengths, status(pending/approved/rejected/withdrawn), createdAt, updatedAt, handledAt, isMine }`；队长看时另有 `applicant: { nickname, avatarUrl }`。11-09 去掉了 `reviews`。
- **长度上限**（字数，超了回 `invalid_<字段>`）：微信号 50、队名 50、专业 30、年级 20、介绍 200、擅长方向 50。专业、年级去掉首尾空格后不能为空。每人最多当 20 个队的队长、30 条待审申请。
- **报错词**：unauthenticated、user_account_disabled、unsupported_action、invalid_*、competition_not_found、team_not_found、application_not_found、member_not_found、team_full、already_member、already_leader、duplicate_application、application_not_pending、not_team_member、not_team_leader、leader_cannot_leave、cannot_remove_self、max_members_below_current、team_limit_exceeded、application_limit_exceeded、team_conflict（同时改同一个队）；其余意外一律 team_failed。11-09 去掉了 team_disbanded、invalid_opinion、invalid_note、leader_decides_directly。

## 转让队长时的微信号

旧队长的微信号不该挂在新队长名下，转让时清空（表里 `leader_wechat` 允许为空）。新队长打开队伍页时 `team.isLeader` 为真、`team.wechat` 为空，小程序提示他填，调 `setWechat` 补上；补上前队员看到的微信号是空字符串。

## 订阅消息：有人申请时通知队长

- **模板**：环境变量 `TEAM_APPLY_TEMPLATE_ID`（模板编号）和 `TEAM_APPLY_TEMPLATE_FIELDS`（模板里每项的键，写法 `比赛=thing1,队伍=thing2,申请人=thing3,时间=time4`；能填的四项：比赛名、队名（没起名写“未命名队伍”）、申请人（“年级 专业”）、申请时间（北京时间“2026年11月08日 10:00”）；文字截到 20 字）。两个都配了才发；缺一个就不发，每条新申请记一行日志。模板还没申请，键要按申请到的模板填。
- **点开到**：`pages/team-applications/team-applications`；`miniprogram_state` 跟提醒一样读 `MINIPROGRAM_STATE`，没配是 formal。
- **次数**：订阅消息授权一次只能发一条。小程序在队长进组队页、建队时调 `wx.requestSubscribeMessage`（用户勾“总是保持以上选择”后不再弹窗，结果照样交回），结果是 accept 就调 `addSubscribeQuota` 记一次（存在 team_notify_quota，每人一条，上限 50；后端核实不了用户是不是真点了接受，所以设上限）。
- **发送**：申请写进库后先扣一次再发（并发的两条申请不会用同一次授权），发出去不等结果，申请照常交回。微信回 43101（用户没授权/拒收）→ 次数清零；别的明确失败（含换不到凭证）→ 退回这一次；请求发出但没拿到结果 → 不退（微信可能已经发了）；没次数不发。
- **复用**：发送用 `发提醒/调度.mjs` 的 `createWeChatSender`（稳定版凭证，和提醒同一套），由 `入口/服务.mjs` 接上交进来；时间格式用 `发提醒/reminderDelivery.js` 的 `formatShanghaiTime`。提醒那边是每条提醒自己记授权状态，没有“次数”这种东西可复用，所以次数单独一张表。

## 同步

粗版本：小程序每次打开组队页调 `listMyTeams`、`listPendingForMe` 取最新，队长、队员看到的就是同一份。

## 待办

- 订阅消息模板还没申请：申请后配 `TEAM_APPLY_TEMPLATE_ID`、`TEAM_APPLY_TEMPLATE_FIELDS`；申请结果（通过/拒绝）通知申请人、被踢通知，先不做。
- 头像图片：现在只存网址（只收 https）。小程序 `chooseAvatar` 给的是本地临时文件，要先传到我们的图片存储换成 https 地址再存，存哪还没定。
- 昵称没做内容安全检查（小程序 `type="nickname"` 的输入框微信会先查一遍）；要更稳可以接 `msgSecCheck`。
- 申请人的联系方式：现在只有队长的微信号，入队后才可见；申请人只能写在介绍里。
- 防刷：同一人短时间反复申请、撤回的频率限制。
- 002、004 都还没部署；部署时按顺序执行（`openUserDb` 打开时会自动补执行没执行过的编号文件）。
