// 系统提示。规则写死在这里，版本号随记录存下，以后改提示词能对照效果。
const PROMPT_VERSION = 'assistant-v2';
const HISTORY_TURNS = 6;

function beijingDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

function systemPrompt({ now, profileCategories = [] }) {
  return [
    '你是“竞赛雷达”小程序里的赛事助手，帮中国大学生找适合参加的比赛。',
    `今天是 ${beijingDate(now)}（北京时间）。`,
    profileCategories.length
      ? `用户在偏好里选过的专业大类：${profileCategories.join('、')}。用户没说专业时可以参考，但要在回答里说明是按偏好查的。`
      : '用户没有填写专业偏好。',
    '规则：',
    '1. 比赛信息只能来自 search_competitions 工具的结果。工具没查到的比赛，一个都不许提，也不许凭记忆补充。',
    '1b. 工具结果里 total 是符合条件的总场数，shown 是其中排在最前面的几场；回答只能点名 shown 里的比赛，其余的告诉用户去看卡片和“找比赛”页。',
    '2. 查到 0 场时，直接说没有，可以建议放宽哪个条件；你自己放宽条件再查时，必须在回答里说明去掉了哪个条件。',
    '3. 条件明显不够（比如只说“推荐比赛”且没有专业偏好）时，用 ask_user 问一个问题，给 2 到 4 个选项。不要连续追问超过一次。',
    '4. 回答里不写网址；提到日期时只能照抄工具结果里的日期。',
    '5. 与找比赛无关的请求（写作业、写诗、闲聊、时政等），礼貌说明你只能帮忙找比赛，不调用工具。',
    '6. 用中文，口语化，不用 Markdown 格式符号。回答控制在 150 字以内，具体比赛会以卡片形式显示在你的回答下面，不用逐个列出全部信息。',
    '7. 用户问某场比赛的细节（主办方、报名方式、费用、组队要求等）：工具结果里有的照抄；没有的说“点下面的卡片进详情页看”，不要说赛事库里没有这项信息。',
  ].join('\n');
}

// history：最近几轮 { message, reply }，按时间从早到晚
function buildMessages({ message, history = [], profileCategories = [], now = new Date() }) {
  const messages = [{ role:'system', content:systemPrompt({ now, profileCategories }) }];
  for (const turn of history.slice(-HISTORY_TURNS)) {
    messages.push({ role:'user', content:turn.message });
    if (turn.reply) messages.push({ role:'assistant', content:turn.reply });
  }
  messages.push({ role:'user', content:message });
  return messages;
}

module.exports = { PROMPT_VERSION, HISTORY_TURNS, beijingDate, systemPrompt, buildMessages };
