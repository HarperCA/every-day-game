# 程序审核（美国/程序审核）

拿记录的字段对照规则：是不是一场具体的大学生专业比赛、资料齐不齐、是不是水赛、能不能上线。寻找流程、维护、后台发布都调这里，规则只有一份。
旧注释的教训：发现层和过滤层各写各的规则，正是 2026-09-21 之前一批错记录的成因；共用以后改收录范围只需改一处。

```
程序审核/
  index.mjs      总的：审核(记录, { 关们, ai, 允许专业待定 }) 按调用方给的几关依次查，碰到不是“通过”的就停；各关的函数也从这里转出
  标题闸/        第 1 关：名称、届次名称里有“通知”、感叹号、报道用语的不收
  范围闸/        第 2 关：是不是一场具体的、大学生能参加的专业比赛
  资料齐不齐/    第 3 关：主办方、参赛对象、资格依据、赛制、专业分类、来源网址
  收录门槛/      第 4 关：规则打分挡水赛；判成“要人看”的经 AI 总管交 DeepSeek 再判（同一个文件，prompt.md 是再判的提示词）
  发布门槛/      发布、归档上线前查一遍
  test/单独/
```

- **记录**用新库的字段名（name、edition_name、organizer、participants、eligibility、format_and_rules、professions、level、parent_id、curation_list、recognition、reward_highlights、authority_signals、introduction、sources、registration_url、registration_start、registration_end、pending_announcement）。
- **结果**：前四关交回“通过 / 待定 / 不收”，发布门槛交回“通过 / 不通过”和所有原因；收录门槛另有“档”：直接收、要人看。
- **资料多少都能调**：范围闸只有标题时也判得出“不收”（中小学、校赛、初赛、目录、喜报、不像一场比赛），看参赛对象、专业的部分没有资料交回“待定”。旧代码在搜索层、入库、发布前、定期审库时都调它。
- **AI**：只有收录门槛的再判要调，AI 总管由调用方传进来（`ai`），这里不读密钥；调用出错抛给调用方，返回内容用不了先 `ai.报告问题` 再抛。
- **谁调**：03 筛选（只取范围闸的“明显不是大学生”，通知、校赛、报道在筛选是追溯线索）；05 审核（范围闸、资料齐不齐、收录门槛，已接上）；06 入库（发布门槛，已接上）和后台发布；维护。

## 搬自哪里（规则不变，字段改成新库的名字）

| 关 | 旧代码 |
|---|---|
| 标题闸 | adminData/noticeResolution.js |
| 范围闸 | adminData/competitionScope.js 的 classifyCompetitionScope、isClearlyOutOfScope |
| 资料齐不齐 | competitionScope.js 的 assessIntakeRecord |
| 收录门槛 | competitionAdmission.js；AI 再判 competitionAdmissionAi.js |
| 发布门槛 | publicCache.js 的 requirePublishGate、requireArchivedGate；registrationSchedule.js；editionTitle.js |

旧发布门槛里“系统校验、人工审核已通过”两条不再查：新结构的状态只有已发布、已归档、待人工审核三种。
后台前端 `apps/admin/src/adminWorkflow.ts` 自己抄了一份通知标题的判断，新后台做到时改成调这里。
