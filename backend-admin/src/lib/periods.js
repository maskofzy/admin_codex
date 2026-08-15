const DAY_MS = 24 * 60 * 60 * 1000;

export function leaderboardPeriods(now, timezoneOffsetMinutes) {
  const local = new Date(now.getTime() + timezoneOffsetMinutes * 60_000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const weekday = local.getUTCDay();
  const mondayOffset = (weekday + 6) % 7;

  return [
    { type: 'day', start: formatDate(year, month, day) },
    { type: 'week', start: formatUtcDate(new Date(Date.UTC(year, month, day) - mondayOffset * DAY_MS)) },
    { type: 'month', start: formatDate(year, month, 1) },
    { type: 'all', start: '1970-01-01' },
  ];
}

export function currentPeriodStart(type, now, timezoneOffsetMinutes) {
  const period = leaderboardPeriods(now, timezoneOffsetMinutes).find(item => item.type === type);
  if (!period) throw new Error(`Unknown leaderboard period: ${type}`);
  return period.start;
}

function formatUtcDate(date) {
  return formatDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function formatDate(year, zeroBasedMonth, day) {
  return `${year}-${String(zeroBasedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
