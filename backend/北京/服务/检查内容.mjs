// 微信明确判定违规才拒绝；服务异常只记录原因，不写入用户原文或身份。
export async function 检查内容({ 微信, openid, scene, log = console.warn }, ...字段) {
  const content = 字段.filter(Boolean).join('\n');
  if (!content || typeof 微信?.msgSecCheck !== 'function') return;
  let 结果;
  try {
    结果 = await 微信.msgSecCheck({ openid, scene, content });
  } catch (error) {
    const code = /^wechat_msg_sec_check_failed:(\d+):/.exec(error?.message || '')?.[1];
    if (code === '87014') throw new Error('content_not_allowed');
    log('[内容安全] 微信检测失败，继续处理', { scene, code: code || error?.name || 'Error' });
    return;
  }
  if (结果?.errcode === 87014 || 结果?.result?.suggest === 'risky') throw new Error('content_not_allowed');
  if (结果?.result?.suggest !== 'pass') log('[内容安全] 微信未给出明确通过结果', { scene, code: 结果?.errcode });
}
