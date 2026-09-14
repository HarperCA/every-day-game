import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function classifyHttpStatus(status) {
  if (status >= 200 && status < 400) return 'reachable';
  if (status === 401 || status === 403) return 'reachable_restricted';
  if (status === 404 || status === 410) return 'not_found';
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'transient_failure';
  return 'http_error';
}

export function normalizeVerifiableUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('unsupported_url');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '0.0.0.0' || hostname === '127.0.0.1' || hostname === '::1') throw new Error('private_target_forbidden');
  return url.href;
}

async function request(url, method, timeoutMs) {
  const started = Date.now();
  const response = await fetch(url, {
    method,
    redirect:'follow',
    signal:AbortSignal.timeout(timeoutMs),
    headers:{
      'user-agent':'Mozilla/5.0 (compatible; DailyContestSourceVerifier/1.0)',
      ...(method === 'GET' ? { range:'bytes=0-0' } : {}),
    },
  });
  const result = { method, status:response.status, finalUrl:response.url, latencyMs:Date.now() - started };
  if (response.body) await response.body.cancel().catch(() => undefined);
  return result;
}

function describeFetchError(error) {
  const parts = [];
  for (let current = error, depth = 0; current && depth < 3; current = current.cause, depth += 1) {
    const code = current.code || current.name;
    const message = current.message;
    const value = [code, message].filter(Boolean).join(': ');
    if (value && !parts.includes(value)) parts.push(value);
  }
  return parts.join(' <- ').slice(0, 500) || String(error).slice(0, 500);
}

async function verifyUrl(rawUrl, timeoutMs) {
  const checkedAt = new Date().toISOString();
  let url;
  try {
    url = normalizeVerifiableUrl(rawUrl);
  } catch (error) {
    return { url:rawUrl, checkedAt, result:'invalid_url', error:error instanceof Error ? error.message : String(error) };
  }
  try {
    let response;
    try {
      response = await request(url, 'HEAD', timeoutMs);
      if (response.status >= 400) response = await request(url, 'GET', timeoutMs);
    } catch (_headError) {
      response = await request(url, 'GET', timeoutMs);
    }
    return { url:rawUrl, checkedAt, result:classifyHttpStatus(response.status), ...response };
  } catch (error) {
    return {
      url:rawUrl,
      checkedAt,
      result:error?.name === 'TimeoutError' ? 'timeout' : 'network_error',
      error:describeFetchError(error),
    };
  }
}

async function mapConcurrent(values, concurrency, mapper) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length:Math.min(concurrency, values.length) }, worker));
  return results;
}

export async function verifySourceUrls({ inputPath, outputPath, timeoutMs = 12000, concurrency = 6 }) {
  const source = JSON.parse(await readFile(inputPath, 'utf8'));
  const dataSources = Array.isArray(source.data_sources) ? source.data_sources : [];
  const urls = [...new Set(dataSources.map(item => item?.url).filter(value => typeof value === 'string' && value.trim()))];
  const results = await mapConcurrent(urls, concurrency, url => verifyUrl(url, timeoutMs));
  const counts = Object.fromEntries([...new Set(results.map(item => item.result))].sort().map(result => [result, results.filter(item => item.result === result).length]));
  const report = {
    generatedAt:new Date().toISOString(),
    input:path.resolve(inputPath),
    policy:'Transport reachability only. This report does not prove that a page is official, current, or semantically relevant and does not change validity_status.',
    sourceCount:dataSources.length,
    uniqueUrlCount:urls.length,
    counts,
    results,
  };
  await mkdir(path.dirname(outputPath), { recursive:true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function main() {
  const inputPath = path.resolve(process.argv[2] || 'data/seed/competitions.json');
  const outputPath = path.resolve(process.argv[3] || 'reports/source-url-verification.json');
  const report = await verifySourceUrls({ inputPath, outputPath });
  console.log(JSON.stringify({ output:outputPath, sourceCount:report.sourceCount, uniqueUrlCount:report.uniqueUrlCount, counts:report.counts }, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
