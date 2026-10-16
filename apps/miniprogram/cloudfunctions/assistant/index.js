// 赛事助手（体验版）。只给测试名单里的人用；正式提交审核的代码里不含这个云函数。
// 设计与取舍见 docs/赛事助手-体验版-第一步后端执行文档.md
const cloud = require('wx-server-sdk');
const { validateAskInput } = require('./askValidation');
const { answer } = require('./assistantCore');
const { isTester } = require('./testers');
const { createSecCheck } = require('./secCheck');
const { createDeepSeekChat } = require('./deepseek');
const { loadPublicRecords } = require('./publicRecords');
const { saveTurnLog, loadRecentTurns } = require('./conversationLog');

cloud.init({ env:cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const chat = createDeepSeekChat(process.env);

exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok:false, message:'unauthenticated' };
  if (event?.action !== 'ask') return { ok:false, message:'unsupported_action' };
  // 不在名单、参数不合格这两种情况不写对话记录：前者不是测试成员，后者没有有效内容
  if (!isTester(OPENID)) return { ok:false, message:'assistant_not_tester' };
  let input;
  try { input = validateAskInput(event); } catch (error) { return { ok:false, message:error.message }; }
  try {
    return await answer(input, {
      openid:OPENID,
      chat,
      secCheck:createSecCheck(cloud, OPENID),
      loadRecords:() => loadPublicRecords(db),
      loadHistory:(openid, sessionId) => loadRecentTurns(db, openid, sessionId),
      saveLog:entry => saveTurnLog(db, entry),
    });
  } catch (error) {
    console.error('[assistant] 未处理的错误', error);
    return { ok:false, message:'assistant_failed' };
  }
};
