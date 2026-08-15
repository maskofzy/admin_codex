export function toIsoUtc(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();

  const source = String(value).trim().replace(' ', 'T');
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(source) ? source : `${source}Z`;
  const date = new Date(zoned);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid UTC timestamp: ${value}`);
  return date.toISOString();
}
