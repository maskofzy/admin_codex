export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return value;
  return `${match[1]}/${match[2]}/${match[3]}`;
}

export function formatNumber(value: string | number): string {
  if (typeof value === 'number') return new Intl.NumberFormat('zh-CN').format(value);
  if (!/^-?\d+$/u.test(value)) return value;
  try {
    return new Intl.NumberFormat('zh-CN').format(BigInt(value));
  } catch {
    return value;
  }
}

export function makeEventId(prefix: string): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function avatarFallback(name: string): string {
  return (name.trim()[0] || '?').toUpperCase();
}
