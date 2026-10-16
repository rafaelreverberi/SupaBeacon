import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { slots, nextSlot, retryDelay } from '../src/schedule.js';
import { defaults, settingsSchema, budget, runnable } from '../../../packages/shared/config.js';
import { vault } from '../src/crypto.js';
test('local windows are deterministic, distributed and unique for frequencies 1–6', () => {
  for (let frequency = 1; frequency <= 6; frequency++) {
    const day = DateTime.fromISO('2026-10-16', { zone: 'Europe/Zurich' }),
      config = { ...defaults, frequency };
    const first = slots(day, config, 'project', 'secret');
    assert.deepEqual(first, slots(day, config, 'project', 'secret'));
    assert.equal(new Set(first).size, frequency);
    for (const [i, t] of first.entries()) {
      const d = DateTime.fromMillis(t, { zone: defaults.timezone });
      assert.equal(d.toISODate(), '2026-10-16');
      assert.ok(d.hour * 60 + d.minute >= (i * 1440) / frequency);
      assert.ok(d.hour * 60 + d.minute < ((i + 1) * 1440) / frequency);
    }
    const samples = Array.from(
      { length: 30 },
      (_, i) => slots(day, config, `project-${i}`, 'secret')[0],
    );
    assert.ok(new Set(samples).size > 20);
  }
});
test('Zurich DST spring/fall and date boundaries remain local-day schedules', () => {
  for (const date of ['2026-03-29', '2026-10-25']) {
    const day = DateTime.fromISO(date, { zone: defaults.timezone });
    assert.equal(
      day.plus({ days: 1 }).toMillis() - day.toMillis(),
      date.includes('03-29') ? 23 * 3600000 : 25 * 3600000,
    );
    const config = { ...defaults, frequency: 6 };
    const list = slots(day, config, 'project', 'seed');
    assert.equal(list.length, 6);
    for (const t of list)
      assert.equal(DateTime.fromMillis(t, { zone: defaults.timezone }).toISODate(), date);
    const next = nextSlot(day.endOf('day').toMillis(), config, 'project', 'seed');
    assert.equal(
      DateTime.fromMillis(next, { zone: defaults.timezone }).toISODate(),
      day.plus({ days: 1 }).toISODate(),
    );
  }
});
test('fixed ambiguous and nonexistent wall times resolve once', () => {
  const config = { ...defaults, frequency: 1, randomized: false, fixedTimes: ['02:30'] };
  for (const day of ['2026-03-29', '2026-10-25'])
    assert.equal(
      slots(DateTime.fromISO(day, { zone: defaults.timezone }), config, 'p', 'k').length,
      1,
    );
});
test('settings bounds, fixed times, timezones and budgeting', () => {
  assert.equal(settingsSchema.safeParse({ ...defaults, frequency: 7 }).success, false);
  assert.equal(settingsSchema.safeParse({ ...defaults, timezone: 'not/a/zone' }).success, false);
  assert.equal(
    settingsSchema.safeParse({ ...defaults, randomized: false, fixedTimes: ['06:00'] }).success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({ ...defaults, fixedTimes: ['06:00', '06:00'] }).success,
    false,
  );
  assert.equal(budget(defaults, 10), 40);
  assert.equal(runnable({ status: 'INACTIVE', present: 1 }), false);
  assert.equal(runnable({ status: 'ACTIVE_HEALTHY', present: 0 }), false);
  assert.equal(runnable({ status: 'ACTIVE_HEALTHY', present: 1 }), true);
});
test('backoff jitter is bounded and Retry-After seconds and dates are honored', () => {
  assert.equal(retryDelay(0, null, 0, 0.5), 1000);
  assert.equal(retryDelay(1, null, 0, 0.5), 2000);
  assert.equal(retryDelay(0, '120', 0, 0), 120000);
  assert.equal(retryDelay(0, 'Thu, 01 Jan 1970 00:02:00 GMT', 0, 0), 120000);
  assert.ok(retryDelay(3, null, 0, 0) >= 6000);
  assert.ok(retryDelay(3, null, 0, 1) <= 10000);
});
test('AES-GCM protects confidentiality and rejects tampering', () => {
  const box = vault('a'.repeat(64)),
    secret = 'fixture-token';
  const encrypted = box.seal({ secret });
  assert.ok(!encrypted.includes(secret));
  assert.deepEqual(box.open(encrypted), { secret });
  const b = Buffer.from(encrypted, 'base64');
  b[30] ^= 1;
  assert.throws(() => box.open(b.toString('base64')));
  assert.throws(() => vault('bad'));
});
