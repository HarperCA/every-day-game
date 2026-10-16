// 前端传来的参数一律不信：逐项校验，不合格的丢掉或直接拒绝。
// 专业大类与 filterOptions.ts、competitionAiReview.js 一致，tests/miniprogram-shared.test.mjs 保证三处相同。
const PROFESSION_CATEGORIES = [
  '综合/不限专业', '计算机与AI', '电子信息', '经管与商科', '生物与医药',
  '机械与自动化', '数学与统计', '材料与化工', '能源与环境', '设计与艺术',
  '人文与法学', '外语与教育', '建筑与土木',
];
const MAX_MESSAGE_CHARS = 300;
const SESSION_ID = /^session-[0-9a-f]{24}$/;

function validateAskInput(event = {}) {
  const message = typeof event.message === 'string' ? event.message.trim() : '';
  // Array.from 按“字”数，不按 UTF-16 编码单元数——表情符号算一个字
  if (!message || Array.from(message).length > MAX_MESSAGE_CHARS) throw new Error('assistant_input_invalid');
  const sessionId = typeof event.sessionId === 'string' && SESSION_ID.test(event.sessionId) ? event.sessionId : '';
  const profileCategories = (Array.isArray(event.profileCategories) ? event.profileCategories : [])
    .filter(value => PROFESSION_CATEGORIES.includes(value));
  return { message, sessionId, profileCategories:[...new Set(profileCategories)] };
}

module.exports = { validateAskInput, PROFESSION_CATEGORIES, MAX_MESSAGE_CHARS };
