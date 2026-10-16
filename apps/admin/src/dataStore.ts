import { queueCloudAudit, queueCloudRecords, saveManualRecords } from './adminCloud';

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

const SOURCE_CONTEXT_FIELDS = ['title', 'content_summary', 'evidence_excerpt', 'supports_fields', 'review_reason'] as const;

export function mergeSeedSourceContext(records: any[], seed: any[]): any[] {
  const seedById = new Map(seed.map(record => [record.id, record]));
  return records.map(record => {
    const seedSources = seedById.get(record.id)?.sources || [];
    if (!seedSources.length || !Array.isArray(record.sources)) return record;
    let changed = false;
    const sources = record.sources.map((source: any) => {
      const matching = seedSources.find((candidate: any) => candidate.id === source.id);
      if (!matching) return source;
      const legacyChallengeCupEntry = source.id === 'source-cmp002-2025-registration' && source.url === 'https://2025.tiaozhanbei.net/';
      if (source.url !== matching.url && !legacyChallengeCupEntry) return source;
      const additions: Record<string, unknown> = {};
      for (const field of SOURCE_CONTEXT_FIELDS) {
        if ((source[field] == null || source[field] === '' || Array.isArray(source[field]) && source[field].length === 0) && matching[field]) additions[field] = matching[field];
      }
      if (legacyChallengeCupEntry) additions.url = matching.url;
      if (!Object.keys(additions).length) return source;
      changed = true;
      return { ...source, ...additions };
    });
    return changed ? { ...record, sources } : record;
  });
}

export function loadAdminRecords(seed: any[]): any[] {
  if (!storageAvailable()) return seed.map(item => ({ ...item }));
  try {
    const saved = JSON.parse(window.localStorage.getItem(RECORDS_KEY) || '[]');
    if (!Array.isArray(saved) || !saved.length) return seed.map(item => ({ ...item }));
    const savedById = new Map(saved.map((item: any) => [item.id, item]));
    return mergeSeedSourceContext(seed.map(item => ({ ...item, ...(savedById.get(item.id) || {}) })), seed);
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

export async function saveAdminRecordsWithAudit(records:any[], entry:Omit<AuditEntry,'id'|'createdAt'>):Promise<AuditEntry[]> {
  const created = {...entry,id:`audit-${crypto.randomUUID()}`,createdAt:new Date().toISOString()};
  await saveManualRecords(records,created);
  replaceAdminRecordCache(records);
  const next = [created,...loadAuditEntries()].slice(0,100);
  replaceAuditCache(next);
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
