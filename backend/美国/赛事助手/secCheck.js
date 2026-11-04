// 微信文本内容安全（msgSecCheck 2.0）。scene=2（评论）：用户的提问、AI 的回答都按“评论”类文本检测。
// 云开发上是 cloud.openapi.security.msgSecCheck；自有服务器上由 apps/server/src/wechat.mjs 提供同名接口。
// suggest：risky 拦截；review（不确定）放行并记录；pass 放行（判断在 assistantCore.js）。
const SCENE_COMMENT = 2;
const MAX_CONTENT_CHARS = 2500;  // 微信接口上限

function createSecCheck(cloud, openid) {
  return async content => {
    const result = await cloud.openapi.security.msgSecCheck({
      openid, scene:SCENE_COMMENT, version:2, content:Array.from(String(content || '')).slice(0, MAX_CONTENT_CHARS).join(''),
    });
    // HTTPS 调用返回 trace_id，云调用返回 traceId，两种都接
    return { suggest:result?.result?.suggest || '', label:result?.result?.label ?? null, traceId:result?.trace_id || result?.traceId || '' };
  };
}

module.exports = { createSecCheck, SCENE_COMMENT, MAX_CONTENT_CHARS };
