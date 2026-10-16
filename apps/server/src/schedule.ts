import { DateTime } from 'luxon';
import { createHmac } from 'node:crypto';
import type { Settings } from '../../../packages/shared/config.js';
/** Local wall-clock windows, with deterministic keyed randomness persisted in jobs. */
export function slots(
  day: DateTime,
  config: Pick<Settings, 'frequency' | 'randomized' | 'fixedTimes'>,
  project: string,
  seed: string,
): number[] {
  const start = day.startOf('day');
  return Array.from({ length: config.frequency }, (_, i) => {
    const hash =
      createHmac('sha256', seed)
        .update(`${project}:${start.toISODate()}:${i}`)
        .digest()
        .readUInt32BE() /
      2 ** 32;
    const minute = config.randomized
      ? Math.floor(((i + 0.1 + hash * 0.8) * 1440) / config.frequency)
      : (() => {
          const [h, m] = (
            config.fixedTimes[i] ?? `${Math.floor(((i + 0.5) * 24) / config.frequency)}:00`
          )
            .split(':')
            .map(Number);
          return h * 60 + m;
        })();
    // Luxon maps nonexistent local times forward and chooses one occurrence for ambiguous times.
    return start
      .set({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0 })
      .toMillis();
  })
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b);
}
export function nextSlot(now: number, config: Settings, project: string, seed: string): number {
  const day = DateTime.fromMillis(now, { zone: config.timezone });
  return [
    ...slots(day, config, project, seed),
    ...slots(day.plus({ days: 1 }), config, project, seed),
  ].find((t) => t > now)!;
}
export function retryDelay(
  attempt: number,
  retryAfter: string | null,
  now = Date.now(),
  jitter = Math.random(),
): number {
  const server = retryAfter
    ? /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : Date.parse(retryAfter) - now
    : 0;
  return Math.max(
    Math.min(60_000, 1000 * 2 ** attempt) * (0.75 + jitter * 0.5),
    Number.isFinite(server) ? Math.max(0, server) : 0,
  );
}
