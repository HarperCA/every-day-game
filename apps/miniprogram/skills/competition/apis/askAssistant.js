const server = require('./server');

const DETAIL_PAGE = 'pages/detail/detail';
const MAX_LIST = 10;
const MAX_QUESTION_CHARS = 300;

// 赛事助手的会话编号：同一次小程序 AI 对话里连续追问时带上，服务器能接着上一轮的条件
let assistantSessionId = '';
let aiSessionId = '';

function deadlineText(card) {
  if (card.registrationStatus === '已截止') return '已截止';
  const date = String(card.registrationEnd || '').slice(0, 10);
  if (!date) return card.registrationEndNote || card.registrationStatus || '时间待公布';
  const left = card.daysLeft === null || card.daysLeft === undefined ? '' : card.daysLeft === 0 ? '，今天截止' : `，还剩 ${card.daysLeft} 天`;
  return `报名截止 ${date}${left}`;
}

const ERROR_TEXT = {
  assistant_input_invalid: '问题为空或太长（最多 300 字），请用户换个说法再问。',
  assistant_timeout: '赛事助手这次没来得及回答，请用户稍后再问一次。',
  assistant_ai_failed: '赛事助手暂时没能回答，请用户稍后再问一次。',
  assistant_check_failed: '这个问题暂时没法回答，请用户换个说法。',
};

async function askAssistant({ question } = {}, context = {}) {
  // 优先用平台透传的用户原文（基础库 3.17.5 起），没有时用模型整理的问题
  const raw = context.query || question;
  const message = typeof raw === 'string' ? raw.trim() : '';
  if (!message) {
    return { isError: true, content: [{ type: 'text', text: '没有拿到用户的问题，请先问清楚用户想找什么比赛（专业、地区、个人还是组队）。' }] };
  }
  // 与服务器 askValidation.js 的上限一致（300 字，表情算一个字），超长的不发到服务器
  if (Array.from(message).length > MAX_QUESTION_CHARS) {
    return { isError: true, content: [{ type: 'text', text: ERROR_TEXT.assistant_input_invalid }] };
  }
  const sessionId = wx.modelContext && wx.modelContext.getSessionId ? wx.modelContext.getSessionId() : '';
  if (sessionId !== aiSessionId) { aiSessionId = sessionId; assistantSessionId = ''; }

  let answer;
  try {
    answer = await server.askAssistant(message, assistantSessionId);
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: ERROR_TEXT[error.message] || '暂时连不上竞赛雷达的服务器，请用户稍后再试。' }] };
  }
  assistantSessionId = answer.sessionId || assistantSessionId;

  const competitions = (answer.cards || []).slice(0, MAX_LIST).map(card => ({
    id: card.id,
    name: card.name,
    eventLevel: card.eventLevel || '',
    registrationStatus: card.registrationStatus || '',
    deadline: deadlineText(card),
    pagePath: `${DETAIL_PAGE}?id=${encodeURIComponent(card.id)}`,
  }));

  let guide;
  if (answer.status === 'clarify') {
    guide = `赛事助手需要先问清楚：${answer.reply}${answer.options && answer.options.length ? `（可选：${answer.options.join('、')}）` : ''}。请把这个问题转述给用户，等用户回答后再调用本接口。`;
  } else if (answer.status === 'blocked') {
    guide = '这个问题不在竞赛雷达的服务范围内，请礼貌告诉用户这里只能帮忙找大学生比赛。';
  } else if (answer.status === 'chat') {
    // 闲聊（“在吗”“谢谢”）：不是查询，不能说成“没找到比赛”
    guide = `用户这句不是在找比赛。赛事助手的回答：${answer.reply}。请自然回应，并提示用户可以说出专业、地区或想参加的比赛类型来找比赛。`;
  } else if (!competitions.length) {
    guide = `赛事库里没有找到符合条件的比赛。赛事助手的回答：${answer.reply}`;
  } else {
    guide = `赛事助手的回答：${answer.reply}\n共 ${answer.total} 场符合条件，下面列出 ${competitions.length} 场（来自竞赛雷达赛事库）。`
      + '请按列表向用户介绍比赛名称和报名截止时间，每场附上详情链接；不要补充列表以外的比赛，也不要改动日期。';
  }

  return {
    isError: false,
    content: [{ type: 'text', text: guide }],
    structuredContent: { status: answer.status, total: answer.total || 0, competitions },
  };
}

module.exports = askAssistant;
