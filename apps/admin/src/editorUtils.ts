function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function collectChangedFields(before: unknown, after: unknown, prefix = ''): string[] {
  if (Object.is(before, after)) return [];

  if (Array.isArray(before) || Array.isArray(after)) {
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix || 'record'];
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap(key => {
      const path = prefix ? `${prefix}.${key}` : key;
      return collectChangedFields(before[key], after[key], path);
    });
  }

  return [prefix || 'record'];
}

export function linesToList(value: string): string[] {
  return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

export function listToLines(value: unknown): string {
  return Array.isArray(value) ? value.join('\n') : '';
}

export function toDateTimeLocal(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00`;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return '';
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return value.slice(0, 16);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : '';
}

export function fromDateTimeLocal(value: string): string | null {
  return value ? `${value}:00+08:00` : null;
}
