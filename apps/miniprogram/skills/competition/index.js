// 小程序 AI 开发模式：注册“找比赛”SKILL 的原子接口（名称与 mcp.json 一致）
const askAssistant = require('./apis/askAssistant');
const getCompetitionDetail = require('./apis/getCompetitionDetail');

const skill = wx.modelContext.createSkill('skills/competition');
skill.registerAPI('askAssistant', askAssistant);
skill.registerAPI('getCompetitionDetail', getCompetitionDetail);
