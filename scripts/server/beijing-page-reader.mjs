import { spawn } from 'node:child_process';

const FORBIDDEN_ERRORS = new Set(['private_url_forbidden', 'invalid_public_url', 'redirect_forbidden', 'too_many_redirects', 'robots_too_large']);
const PAGE_STATUSES = new Set(['ok', 'blocked', 'error', 'timeout', 'too_short', 'network_error', 'invalid_url', 'unsupported_protocol', 'unsupported_type', 'too_large', 'too_many_redirects']);
function validatePage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (!PAGE_STATUSES.has(value.status) && !/^http_\d{3}$/.test(value.status || '')) ||
      typeof value.text !== 'string' || value.text.length > 12000 ||
      (value.links !== undefined && (!Array.isArray(value.links) || value.links.length > 10 || value.links.some(link => !link || typeof link.url !== 'string' || typeof link.text !== 'string'))) ||
      (value.error !== undefined && typeof value.error !== 'string')) throw Error('beijing_reader_invalid_response');
  return { ...value, links: value.links || [], via: 'beijing' };
}

export function createBeijingReader(fallback, {
  host = process.env.BEIJING_READER_HOST, key = process.env.BEIJING_READER_KEY, spawnImpl = spawn,
  timeoutMs = 45000, killGraceMs = 1000, maxOutputBytes = 128 * 1024,
} = {}) {
  return async url => {
    if (!host || !key) return fallback(url);
    let page;
    try {
      page = await new Promise((resolve, reject) => {
        const child = spawnImpl('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=yes', '-i', key, host], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        const body = []; let length = 0, failure, settled = false, killTimer, finalTimer;
        const finish = (error, value) => {
          if (settled) return; settled = true;
          clearTimeout(timer); clearTimeout(killTimer); clearTimeout(finalTimer);
          if (error) reject(error); else resolve(value);
        };
        const stop = error => {
          if (failure || settled) return; failure = error; clearTimeout(timer);
          child.kill();
          if (settled) return; // Test doubles or a fast process may close synchronously.
          killTimer = setTimeout(() => {
            child.kill('SIGKILL');
            if (!settled) finalTimer = setTimeout(() => finish(failure), killGraceMs);
          }, killGraceMs);
        };
        const timer = setTimeout(() => stop(Error('beijing_reader_timeout')), timeoutMs);
        child.stdout.on('data', chunk => {
          if (failure || settled) return;
          length += chunk.length;
          if (length > maxOutputBytes) stop(Error('beijing_reader_output_limit'));
          else body.push(Buffer.from(chunk));
        });
        child.stderr.on('data', chunk => {
          if (failure || settled) return;
          length += chunk.length;
          if (length > maxOutputBytes) stop(Error('beijing_reader_output_limit'));
        });
        child.stdin.on('error', () => {}); // Close/exit captures SSH failures, including EPIPE.
        child.once('error', () => finish(Error('beijing_reader_spawn_error')));
        child.once('close', (code, signal) => {
          if (failure) { finish(failure); return; }
          try {
            const result = validatePage(JSON.parse(Buffer.concat(body).toString('utf8')));
            // A remote policy rejection intentionally exits 1. Never trust successful content from a failed SSH process.
            if (code !== 0 && !(code === 1 && result.status === 'error' && FORBIDDEN_ERRORS.has(result.error))) throw Error(`beijing_reader_exit_${Number.isInteger(code) ? code : signal || 'unknown'}`);
            finish(null, result);
          } catch (error) { finish(error instanceof SyntaxError ? Error('beijing_reader_invalid_response') : error); }
        });
        child.stdin.end(JSON.stringify({ url }));
      });
    } catch (error) {
      const alternate = await fallback(url);
      return { ...alternate, beijingStatus: 'transport_error', beijingError: error.message };
    }
    if (page.status === 'ok' || page.status === 'blocked' || FORBIDDEN_ERRORS.has(page.error)) return page;
    if (!['error', 'timeout', 'too_short', 'network_error'].includes(page.status)) return page;
    const alternate = await fallback(url);
    return { ...alternate, beijingStatus: page.status, ...(page.error ? { beijingError: page.error } : {}) };
  };
}
