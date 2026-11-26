export function parseAgyResetTimestamp(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+([+-]\d{2})(?::?(\d{2}))?$/.exec(raw.trim());
  if (!match) {
    const fallback = Date.parse(raw);
    return Number.isFinite(fallback) ? fallback : null;
  }
  const [, datePart, timePart, tzHour, tzMin = '00'] = match;
  const iso = `${datePart}T${timePart}:00${tzHour}:${tzMin}`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatResetCountdown(raw: string | undefined, nowMs = Date.now()): string {
  if (!raw) {
    return '--';
  }
  const targetMs = parseAgyResetTimestamp(raw);
  if (targetMs === null) {
    return raw;
  }

  const diffMs = Math.max(0, targetMs - nowMs);
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;

  let relative: string;
  if (days > 0) {
    relative = `in ${days}d ${hours}h`;
  } else if (hours > 0) {
    relative = `in ${hours}h ${mins}m`;
  } else {
    relative = `in ${mins}m`;
  }

  const localDate = new Date(targetMs);
  const hhmm = `${pad2(localDate.getHours())}:${pad2(localDate.getMinutes())}`;

  if (days > 0) {
    return `${relative} · ${MONTHS[localDate.getMonth()]} ${localDate.getDate()}, ${hhmm}`;
  }
  return `${relative} · ${hhmm}`;
}
