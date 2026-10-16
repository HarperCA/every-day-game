import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function syncSourceKey(endpoint) {
  const url = new URL(endpoint);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid_sync_endpoint');
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return crypto.createHash('sha256').update(url.href).digest('hex').slice(0, 24);
}

export function sourceStateFile(directory, kind, endpoint) {
  return path.join(directory, `${kind}-state-${syncSourceKey(endpoint)}.json`);
}

export function readSourceState(file, endpoint) {
  if (!fs.existsSync(file)) return {};
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (state.sourceKey !== syncSourceKey(endpoint)) throw new Error('sync_state_source_mismatch');
  return state;
}

export function writeSourceState(file, endpoint, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ...state, sourceKey: syncSourceKey(endpoint) }, null, 1));
  fs.renameSync(temporary, file);
}
