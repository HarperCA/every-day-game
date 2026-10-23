// 小程序 AI 开发模式：原子接口跑在微信客户端的独立环境里，不能引用主包代码（独立分包），
// 所以这里单独写一份请求自有服务器的工具。地址与 config/cloud.ts 的 FEEDBACK_API_BASE_URL 保持一致。
const ORIGIN = 'https://107-175-111-18.sslip.io';
const SESSION_KEY = 'wxai-skill-session-v1';

function post(path, data, timeout = 25000) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: ORIGIN + path,
      method: 'POST',
      timeout,
      header: { 'content-type': 'application/json' },
      data,
      success(response) {
        const body = response && response.data;
        if (response.statusCode < 200 || response.statusCode >= 300 || !body || body.ok !== true) {
          reject(new Error((body && body.message) || `服务返回 ${response.statusCode}`));
          return;
        }
        resolve(body.data);
      },
      fail(error) {
        reject(new Error(/timeout|timed_out|fail/i.test(String(error && error.errMsg)) ? '网络不太稳定' : '网络请求失败'));
      },
    });
  });
}

// 和小程序里一样：wx.login 换 code → /api/login 换会话凭证；凭证存本地，过期再重新登录
async function sessionToken(force = false) {
  if (!force) {
    const saved = wx.getStorageSync(SESSION_KEY);
    if (saved) return saved;
  }
  const code = await new Promise((resolve, reject) => {
    wx.login({ success: res => (res && res.code ? resolve(res.code) : reject(new Error('微信登录未返回 code'))), fail: () => reject(new Error('微信登录失败')) });
  });
  const result = await post('/api/login', { code }, 15000);
  if (!result || !result.userSessionToken) throw new Error('登录服务暂不可用');
  wx.setStorageSync(SESSION_KEY, result.userSessionToken);
  return result.userSessionToken;
}

// 赛事助手：服务器上就是小程序里“问问助手”用的同一个接口（DeepSeek 把问题转成筛选条件，从赛事库查比赛）
async function askAssistant(message, sessionId) {
  const send = async force => post('/api/assistant', { action: 'ask', message, ...(sessionId ? { sessionId } : {}), userSessionToken: await sessionToken(force) });
  try {
    return await send(false);
  } catch (error) {
    if (error.message !== 'user_session_expired') throw error;
    wx.removeStorageSync(SESSION_KEY);
    return send(true);
  }
}

// 比赛详情：公开数据，不需要登录
function getCompetition(id) {
  return post('/api/publicData', { action: 'get', id }, 15000);
}

module.exports = { askAssistant, getCompetition };
