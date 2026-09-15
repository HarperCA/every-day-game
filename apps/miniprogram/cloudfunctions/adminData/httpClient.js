// 云函数运行时可能是 Nodejs16 及以下，没有全局 fetch。
// 这里用内置 http/https 实现一个够用的 fetch 子集，接口与 fetch 保持一致，
// 这样 competitionAiReview 无论跑在哪个运行时上都不用改调用方式。
const http = require('node:http');
const https = require('node:https');

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15000;

function buildResponse(status, headers, body) {
  return {
    ok:status >= 200 && status < 300,
    status,
    headers:{ get:name => headers[String(name).toLowerCase()] ?? null },
    text:async () => body.toString('utf8'),
    json:async () => JSON.parse(body.toString('utf8')),
  };
}

function requestOnce(url, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (error) {
      reject(new Error(`invalid_url:${url}`));
      return;
    }
    // 必须是总时长超时，不能只用 request.setTimeout —— 后者是 socket 空闲超时，
    // 而大模型会持续吐 token，连接一直有数据，空闲超时永远不触发，
    // 调用就会一路跑到云函数 60 秒硬上限被平台掐断。
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    };
    const transport = target.protocol === 'http:' ? http : https;
    const request = transport.request(target, {
      method:options.method || 'GET',
      headers:options.headers || {},
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => finish(resolve, {
        status:response.statusCode || 0,
        headers:response.headers,
        location:response.headers.location,
        body:Buffer.concat(chunks),
      }));
      response.on('error', error => finish(reject, error));
    });
    const deadline = setTimeout(() => {
      request.destroy();
      finish(reject, new Error(`request_timeout_after_${timeoutMs}ms`));
    }, timeoutMs);
    request.setTimeout(timeoutMs, () => request.destroy());
    request.on('error', error => finish(reject, error));
    if (options.body) request.write(options.body);
    request.end();
  });
}

function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function nodeFetch(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const followRedirects = options.redirect !== 'manual';
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const raw = await requestOnce(current, options, timeoutMs);
    if (followRedirects && isRedirect(raw.status) && raw.location) {
      current = new URL(raw.location, current).toString();
      continue;
    }
    return buildResponse(raw.status, raw.headers, raw.body);
  }
  throw new Error(`too_many_redirects:${url}`);
}

module.exports = { buildResponse, isRedirect, nodeFetch };
