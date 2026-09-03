// Local calendar dates, represented as 'YYYY-MM-DD' strings.
//
// Never derived from an instant: a UTC timestamp re-buckets history when the
// user travels, and toISOString() shifts the date for anyone west of
// Greenwich in the evening. These keys sort lexicographically, which is what
// makes the range queries in db.js work.

export function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function today() {
  return toDayKey(new Date());
}

export function parseDayKey(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day, delta) {
  const date = parseDayKey(day);
  date.setDate(date.getDate() + delta);
  return toDayKey(date);
}

export function isFuture(day) {
  return day > today();
}

// The `count` days ending at `day`, oldest first.
export function daysEndingAt(day, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(addDays(day, -i));
  return out;
}

const LONG = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const SHORT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function formatDay(day) {
  return LONG.format(parseDayKey(day));
}

export function formatDayShort(day) {
  return SHORT.format(parseDayKey(day));
}

export function formatTime(epochMs) {
  return TIME.format(new Date(epochMs));
}

// 'Today', 'Yesterday', or null when the day deserves no special name.
export function dayName(day) {
  const now = today();
  if (day === now) return 'Today';
  if (day === addDays(now, -1)) return 'Yesterday';
  if (day === addDays(now, 1)) return 'Tomorrow';
  return null;
}
