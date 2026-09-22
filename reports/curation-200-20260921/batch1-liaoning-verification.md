# 新增200场核验任务 · 批次1核验清单（辽宁省教育厅官方平台）

- 核验时间：2026-09-22
- 信源：辽宁省大学生创新创业管理共享平台（官方，辽宁省教育厅主办），`cxcy.upln.cn`，接口 `/provincial/match/competition/queryOngoing` + `/provincial/match/competition/detail`
- 处理方式：抓取该平台"进行中"（code=1）与"未开始"（code=0）2026年度全部条目共28条 → 官方详情页正文逐条核验 → 与库内现有283条按规范名称/关键词模糊匹配去重 → 剔除7条实为已有全国赛在辽宁的省赛区／重复承办通知 → 剩余21条为库内此前未收录的独立辽宁省级赛事 → 逐条填写主办方/承办单位/参赛资格/赛制/时间/来源，写入 `saveRecords`（版本823→833，全部以draft状态入库，等待管理端人工审核发布）
- 备份：写入前已确认使用既有备份 `curation-200-before-20260921.db` + `curation-200-baseline-20260921.json`（version 823，283条，capturedAt 2026-09-21T11:32:05.745Z）
- 撤回标识：本批次全部记录带 `curationBatch: "curation200-batch1-liaoning-20260922"` 字段，可据此单独筛选撤回

## 计入新增的21条（均为库内此前不存在的独立赛事）

| # | 记录ID | 赛事名称 | 承办单位 | 官方来源 |
|---|---|---|---|---|
| 1 | edition-liaoning-social-work-practice-2026 | 辽宁省大学生社会工作实务技能大赛 | 鞍山师范学院 | cxcy.upln.cn detail?id=06bae1e1... |
| 2 | edition-liaoning-culture-creative-design-2026 | 2026年第四届辽宁省大学生文化创意设计大赛 | 鲁迅美术学院 | detail?id=112e39e4... |
| 3 | edition-liaoning-jindie-cloud-innovation-2026 | 2026年辽宁省大学生金蝶云管理创新杯大赛 | 沈阳城市学院 | detail?id=113e0d97... |
| 4 | edition-liaoning-business-elite-challenge-2026 | 辽宁高校商业精英挑战赛 | 东北财经大学 | detail?id=129f1c01... |
| 5 | edition-liaoning-foreign-language-skill-challenge-2026 | 第一届辽宁省大学生外语综合技能创新挑战赛 | 大连外国语大学 | detail?id=178860d2... |
| 6 | edition-liaoning-welding-casting-design-2026 | 第一届辽宁省大学生材料焊接与铸造工艺设计大赛 | 大连交通大学 | detail?id=1c464bc7... |
| 7 | edition-liaoning-digital-trade-innovation-2026 | 辽宁省大学生数字贸易创新创业大赛 | 辽宁对外经贸学院 | detail?id=1eccc2d7... |
| 8 | edition-liaoning-architecture-innovation-design-2026 | 辽宁省大学生建筑创新设计竞赛暨东北三省适老化建筑设计竞赛 | 沈阳建筑大学 | detail?id=2346a8d3... |
| 9 | edition-liaoning-integrated-circuit-innovation-2026 | 第八届辽宁省大学生集成电路创新创业大赛 | 沈阳工业大学 | detail?id=2d83f46f... |
| 10 | edition-liaoning-classics-recitation-writing-2026 | 2026年辽宁省高校中外大学生中华经典诵写讲大赛 | 辽宁师范大学 | detail?id=3d172f1f... |
| 11 | edition-liaoning-agricultural-economic-modeling-2026 | 第七届辽宁省大学生农业经济建模大赛 | 大连海洋大学 | detail?id=4912c928... |
| 12 | edition-liaoning-intercultural-competence-2026 | 第九届"外教社杯"全国高校学生跨文化能力大赛（辽宁赛区） | 大连海事大学 | detail?id=55592a23... |
| 13 | edition-liaoning-original-dance-work-2026 | 辽宁省第五届高校舞蹈原创作品大赛 | 辽宁师范大学 | detail?id=717e9922... |
| 14 | edition-liaoning-business-comprehensive-ability-2026 | 2026年第五届辽宁省大学生商科综合能力大赛 | 大连民族大学 | detail?id=8b4d898c... |
| 15 | edition-liaoning-bigdata-application-analysis-2026 | 辽宁省普通高等学校大学生大数据应用与分析大赛 | 大连工业大学 | detail?id=8f0d6351... |
| 16 | edition-liaoning-vr-newmedia-innovation-design-2026 | 2026年第五届辽宁省大学生虚拟现实与新媒体创新设计大赛 | 辽宁科技大学 | detail?id=90d98393... |
| 17 | edition-liaoning-engineering-practice-innovation-2026 | 辽宁省大学生工程实践与创新能力大赛 | 辽宁石油化工大学 | detail?id=a4e9b87a... |
| 18 | edition-liaoning-economic-decision-virtual-sim-2026 | 第七届辽宁省高校经济决策虚仿实验大赛 | 沈阳大学 | detail?id=bf828c95... |
| 19 | edition-liaoning-digital-finance-bigdata-2026 | 2026年第一届辽宁省大学生数智财经大数据分析与应用大赛 | 辽宁工程技术大学 | detail?id=e60cce6f... |
| 20 | edition-liaoning-raicom-robot-developer-2026 | 2026年辽宁省睿抗机器人开发者大赛（暨全国睿抗辽宁分赛区） | 辽宁工程技术大学 | detail?id=ebb6dbb7... |
| 21 | edition-liaoning-smart-power-operation-control-2026 | 2026年辽宁省大学生智慧电力运行控制创新竞赛 | 沈阳工程学院 | detail?id=f7f1ef3a... |

## 排除的7条（不计入新增，理由）

全部经关键词比对，确认是库内已有全国性赛事在辽宁省的赛区／校内选拔通知，或与已有记录同名同实：

1. 全国大学生广告艺术大赛（辽宁赛区）— 与已有"全国大学生广告艺术大赛"（archived）为同一全国赛的省赛区
2. 中国大学生机械工程创新创意大赛-无损检测创新实践与应用赛（辽宁赛区）— 与已有"2026年中国大学生机械工程创新创意大赛"（draft）同源
3. 辽宁省大学生食品与健康创新大赛 — 库内已有对应校内选拔通知记录（沈阳科技学院，draft）
4. "西门子"杯中国智能制造挑战赛(辽宁赛区) — 与已有"西门子杯"中国智能制造挑战赛（archived）为同一全国赛的省赛区
5. "辽宁故事"杯农特产品包装创新创意大赛 — 库内已有同名已发布记录（published）
6. "科云杯"全国大学生财会职业能力大赛（辽宁赛区）— 与已有"2026年第十一届'科云杯'全国大学生财会职业能力大赛"（published）为同一全国赛的省赛区
7. 第五届辽宁省大学生商业设计创意大赛 — 与已有"2026年第五届辽宁省大学生商业设计创意大赛"（published）同名同实

## 待补事项（不影响入库，留待管理端发布前补齐）

- 全部21条报名费信息未在官方实施方案正文中明确说明，标注"暂未公布"，不得推断为免费
- 商科综合能力大赛（#14）正文仅指向附件通知文件，赛制细节需人工下载附件后补全
- 全部21条当前状态为 `draft`，未经系统验证（systemValidation=not_run）与人工复核（manualReview=pending），符合发布门槛要求，需走既有审核发布流程后才能进入 `published`

## 修正记录

- 2026-09-22（同日）：发现21条记录的 `registrationUrl` 误填为平台首页 `https://cxcy.upln.cn/`，而非具体比赛详情页，不算合格报名入口。已用 `curation-200-batch1-fix-registration-url.mjs` 改为各自 `detail?id=...` 详情页链接（该平台报名动作在详情页完成），version 833→850，21条全部修正，抽查核对 `registrationUrl` 与 `sources[0].url` 一致。
