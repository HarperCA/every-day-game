export function hasReviewedOfficialSource(record: any): boolean {
  return (Array.isArray(record.sources) ? record.sources : []).some((source: any) =>
    source?.id && source.source_type
    && !['discovery_notice','university_notice','search_candidate'].includes(source.source_type)
    && source.is_official === true && source.validity_status === 'valid'
    && /^https?:\/\//i.test(source.url || '')
    && (!source.edition_id || source.edition_id === record.id)
    && Number.isFinite(Date.parse(source.last_verified_at || ''))
    && ['title', 'content_summary', 'evidence_excerpt', 'review_reason'].every(field =>
      typeof source[field] === 'string' && source[field].trim())
    && Array.isArray(source.supports_fields)
    && source.supports_fields.some((field: unknown) => typeof field === 'string' && field.trim()));
}
