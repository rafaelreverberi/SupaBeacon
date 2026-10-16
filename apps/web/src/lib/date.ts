import { DateTime } from 'luxon';
let displayZone = 'Europe/Zurich',
  display12h = false;
export const time = (value: number | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: displayZone,
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: display12h,
      }).format(value)
    : '—';
export const duration = (seconds: number) =>
  seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    : `${Math.floor(seconds / 60)}m`;
export function configureDates(zone: string, twelveHour: boolean) {
  displayZone = zone;
  display12h = twelveHour;
}

export function localDateRange(value: string) {
  const day = DateTime.fromISO(value, { zone: displayZone }).startOf('day');
  return { from: String(day.toMillis()), to: String(day.endOf('day').toMillis()) };
}
