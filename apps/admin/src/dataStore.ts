import { queueCloudAudit, queueCloudRecords } from './adminCloud';

const RECORDS_KEY = 'competition-admin-records-v2';
const AUDIT_KEY = 'competition-admin-audit-v2';

export interface AuditEntry {
  id: string;
  action: string;
  objectType?: string;
  recordId: string;
  recordName: string;
  changedFields: string[];
  createdAt: string;
  actor: string;
  reason?: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
}

function storageAvailable() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

export function loadAdminRecords(seed: any[]): any[] {
  if (!storageAvailable()) return seed.map(item => ({ ...item }));
  try {
    const saved = JSON.parse(window.localStorage.getItem(RECORDS_KEY) || '[]');
    if (!Array.isArray(saved) || !saved.length) return seed.map(item => ({ ...item }));
    const savedById = new Map(saved.map((item: any) => [item.id, item]));
    return seed.map(item => ({ ...item, ...(savedById.get(item.id) || {}) }));
  } catch (_error) {
    return seed.map(item => ({ ...item }));
  }
}

export function replaceAdminRecordCache(records: any[]) {
  if (storageAvailable()) window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

export function persistAdminRecords(records: any[]) {
  replaceAdminRecordCache(records);
  queueCloudRecords(records);
}

export function loadAuditEntries(): AuditEntry[] {
  if (!storageAvailable()) return [];
  try {
    const entries = JSON.parse(window.localStorage.getItem(AUDIT_KEY) || '[]');
    return Array.isArray(entries) ? entries : [];
  } catch (_error) {
    return [];
  }
}

export function replaceAuditCache(entries: AuditEntry[]) {
  if (storageAvailable()) window.localStorage.setItem(AUDIT_KEY, JSON.stringify(entries.slice(0, 100)));
}

function appendAuditEntryToCache(entry: Omit<AuditEntry, 'id' | 'createdAt'>) {
  const entries = loadAuditEntries();
  const created = { ...entry, id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString() };
  const next = [created, ...entries].slice(0, 100);
  if (storageAvailable()) window.localStorage.setItem(AUDIT_KEY, JSON.stringify(next));
  return { created, next };
}

export function appendAuditEntry(entry: Omit<AuditEntry, 'id' | 'createdAt'>): AuditEntry[] {
  const { created, next } = appendAuditEntryToCache(entry);
  queueCloudAudit(created);
  return next;
}

export function persistAdminRecordsWithAudit(records: any[], entry: Omit<AuditEntry, 'id' | 'createdAt'>): AuditEntry[] {
  replaceAdminRecordCache(records);
  const { created, next } = appendAuditEntryToCache(entry);
  queueCloudRecords(records, created);
  return next;
}

export function resetAdminRecords(seed: any[]) {
  const records = seed.map(item => ({ ...item }));
  persistAdminRecordsWithAudit(records, { action: 'reset', recordId: '*', recordName: '全部赛事', changedFields: ['records'], actor: 'admin@example.local' });
  return records;
}

export function downloadRecords(records: any[]) {
  downloadJson('competition-admin-export', { records });
}

export function downloadJson(prefix: string, data: unknown) {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), ...((data && typeof data === 'object') ? data : { data }) }, null, 2);
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
