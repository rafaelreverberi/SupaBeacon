import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import {
  settingsSchema,
  runnable,
  type Project,
  type Settings,
} from '../../../packages/shared/config.js';
import { nextSlot, retryDelay } from './schedule.js';
import { Supabase, Discovery, ServiceError } from './supabase.js';
export class Engine {
  private active = new Map<string, Promise<void>>();
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private abort = new AbortController();
  private syncing = false;
  private nextSyncAttempt = 0;
  constructor(
    public api: Supabase,
    public discovery: Discovery,
    public seed: string,
  ) {}
  config(p: Project): Settings {
    const base = this.api.store.settings(),
      override = p.overrides ? JSON.parse(p.overrides) : {};
    const merged = { ...base, ...override };
    if (!merged.randomized && merged.fixedTimes.length !== merged.frequency)
      merged.fixedTimes = Array.from(
        { length: merged.frequency },
        (_, i) => `${String(Math.floor(((i + 0.5) * 24) / merged.frequency)).padStart(2, '0')}:00`,
      );
    return settingsSchema.parse(merged);
  }
  plan(p: Project, now = Date.now()) {
    const s = this.api.store;
    if (!p.enabled || !runnable(p)) {
      s.db
        .prepare("UPDATE jobs SET state='cancelled' WHERE project_id=? AND state='pending'")
        .run(p.id);
      s.db.prepare('UPDATE projects SET next_run=NULL WHERE id=?').run(p.id);
      return;
    }
    const existing = s.db
      .prepare("SELECT due FROM jobs WHERE project_id=? AND state='pending' ORDER BY due LIMIT 1")
      .get(p.id) as { due: number } | undefined;
    const due = existing?.due ?? nextSlot(now, this.config(p), p.id, this.seed);
    s.db
      .prepare(
        "INSERT INTO jobs(project_id,due) VALUES(?,?) ON CONFLICT(project_id,due) DO UPDATE SET state='pending' WHERE jobs.state='cancelled'",
      )
      .run(p.id, due);
    s.db.prepare('UPDATE projects SET next_run=? WHERE id=?').run(due, p.id);
  }
  reschedule() {
    const s = this.api.store;
    s.db.prepare("UPDATE jobs SET state='cancelled' WHERE state='pending'").run();
    for (const p of s.projects()) this.plan(p);
  }
  start() {
    const s = this.api.store;
    s.db
      .prepare(
        "UPDATE executions SET state='interrupted',finished=?,error='PROCESS_INTERRUPTED' WHERE state='running'",
      )
      .run(Date.now());
    // Claimed jobs are never replayed; remote effects cannot be made exactly-once after a crash.
    s.db.prepare("UPDATE jobs SET state='interrupted' WHERE state='running'").run();
    s.prune();
    s.log('info', 'scheduler_started');
    this.timer = setInterval(() => this.tick(), 2000);
    this.timer.unref();
    this.tick();
  }
  tick(now = Date.now()) {
    if (this.stopping) return;
    const s = this.api.store,
      config = s.settings();
    if (
      this.api.status().connected &&
      s.get('sync_error') !== 'PROJECT_PERMISSION_DENIED' &&
      !this.syncing &&
      now >= this.nextSyncAttempt &&
      now - (s.get<number>('last_sync') ?? 0) >= config.discoveryHours * 3600_000
    ) {
      this.syncing = true;
      void this.discovery
        .sync()
        .catch(() => {
          this.nextSyncAttempt = now + 60_000;
        })
        .finally(() => {
          this.syncing = false;
        });
    }
    for (const p of s.projects()) this.plan(p, now);
    if (now - (s.get<number>('last_prune') ?? 0) > 3600_000) {
      s.prune();
      s.set('last_prune', now);
    }
    if (!config.enabled || !this.api.status().connected) return;
    const jobs = s.db
      .prepare(
        "SELECT id,project_id,due FROM jobs WHERE state='pending' AND due<=? ORDER BY due LIMIT 100",
      )
      .all(now) as { id: number; project_id: string; due: number }[];
    for (const job of jobs) {
      const p = s.project(job.project_id)!;
      if (now - job.due > 15 * 60_000) {
        s.db.prepare("UPDATE jobs SET state='skipped' WHERE id=?").run(job.id);
        s.log('info', 'missed_heartbeat_skipped', p.id);
        this.plan(p, now);
        continue;
      }
      if (this.active.size >= config.concurrency || this.active.has(p.id)) continue;
      s.db.prepare("UPDATE jobs SET state='running' WHERE id=? AND state='pending'").run(job.id);
      const id = this.launch(p, 'scheduled');
      void this.active.get(p.id)?.finally(() => {
        s.db.prepare("UPDATE jobs SET state='completed' WHERE id=?").run(job.id);
        this.plan(s.project(p.id)!, Date.now());
      });
      if (!id) s.db.prepare("UPDATE jobs SET state='skipped' WHERE id=?").run(job.id);
    }
  }
  run(id: string) {
    const s = this.api.store,
      p = s.project(id);
    if (!p) throw new ServiceError('PROJECT_NOT_FOUND', 404);
    if (this.stopping || !s.settings().enabled) throw new ServiceError('SCHEDULER_PAUSED', 409);
    if (!this.api.status().connected) throw new ServiceError('SUPABASE_NOT_CONNECTED', 409);
    if (!runnable(p)) throw new ServiceError('PROJECT_NOT_ACTIVE', 409);
    if (this.active.has(id)) throw new ServiceError('PROJECT_ALREADY_RUNNING', 409);
    if (this.active.size >= s.settings().concurrency)
      throw new ServiceError('CONCURRENCY_LIMIT', 409);
    return this.launch(p, 'manual');
  }
  private launch(p: Project, source: string) {
    const id = randomUUID(),
      s = this.api.store;
    s.db
      .prepare(
        "INSERT INTO executions(id,project_id,source,strategy,state,started) VALUES(?,?,?,?,'running',?)",
      )
      .run(id, p.id, source, p.strategy, Date.now());
    const work = this.execute(id, p)
      .catch(() => {
        s.db
          .prepare(
            "UPDATE executions SET state='failed',error='INTERNAL_EXECUTION_ERROR',finished=? WHERE id=?",
          )
          .run(Date.now(), id);
        s.log('error', 'heartbeat_internal_error', p.id);
      })
      .finally(() => {
        this.active.delete(p.id);
      });
    this.active.set(p.id, work);
    s.log('info', `${source}_heartbeat_started`, p.id, { execution: id });
    return id;
  }
  private async execute(id: string, p: Project) {
    const s = this.api.store,
      config = this.config(p),
      start = Date.now();
    let attempts = 0,
      successes = 0,
      error: string | null = null;
    for (let n = 0; n < config.requests; n++) {
      for (let retry = 0; ; retry++) {
        if (this.stopping || !s.settings().enabled) {
          error = 'EXECUTION_STOPPED';
          break;
        }
        const at = Date.now();
        let status: number | null = null;
        try {
          // Refresh actual provider status immediately before every operation.
          const actual = (await (await this.api.api(`/projects/${p.id}`)).json()) as {
            status?: string;
          };
          if (typeof actual.status !== 'string') throw new ServiceError('INVALID_PROJECT_RESPONSE');
          s.db.prepare('UPDATE projects SET status=? WHERE id=?').run(actual.status, p.id);
          if (actual.status !== 'ACTIVE_HEALTHY') throw new ServiceError('PROJECT_NOT_ACTIVE', 409);
          let r: Response;
          if (p.strategy === 'management') {
            attempts++;
            s.db.prepare('UPDATE executions SET requests=? WHERE id=?').run(attempts, id);
            r = await this.api.api(`/projects/${p.id}/database/query/read-only`, {
              method: 'POST',
              body: JSON.stringify({ query: 'SELECT 1 AS heartbeat;' }),
            });
            status = r.status;
            const body: unknown = await r.json();
            if (!Array.isArray(body) || body.length !== 1 || body[0]?.heartbeat !== 1)
              throw new ServiceError('DATABASE_RESULT_UNVERIFIED', 502);
          } else {
            if (!p.safe_table) throw new ServiceError('SAFE_TABLE_REQUIRED');
            const key = await this.api.publicKey(p.id);
            attempts++;
            s.db.prepare('UPDATE executions SET requests=? WHERE id=?').run(attempts, id);
            r = await this.api.request(
              `https://${p.id}.supabase.co/rest/v1/${encodeURIComponent(p.safe_table)}?select=*&limit=1`,
              { method: 'HEAD', headers: { apikey: key } },
            );
            status = r.status;
            if (!r.ok || !r.headers.has('content-range')) {
              await r.body?.cancel();
              throw new ServiceError(
                r.status === 429 ? 'RATE_LIMITED' : 'DATA_QUERY_FAILED',
                r.status === 200 ? 502 : r.status,
                r.headers.get('retry-after'),
              );
            }
            await r.body?.cancel();
          }
          successes++;
          s.db.transaction(() => {
            s.db
              .prepare(
                'INSERT INTO execution_requests(execution_id,at,status,duration,ok) VALUES(?,?,?,?,1)',
              )
              .run(id, at, status, Date.now() - at);
            s.db
              .prepare('UPDATE executions SET successes=?,database_ok=1 WHERE id=?')
              .run(successes, id);
            s.db.prepare('UPDATE projects SET last_success=? WHERE id=?').run(Date.now(), p.id);
          })();
          s.log('info', 'database_query_succeeded', p.id, { execution: id, strategy: p.strategy });
          error = null;
          break;
        } catch (e) {
          const fault =
            e instanceof ServiceError ? e : new ServiceError('INVALID_UPSTREAM_RESPONSE', 502);
          error = fault.code;
          status ??= fault.status;
          s.db
            .prepare(
              'INSERT INTO execution_requests(execution_id,at,status,duration,ok,error) VALUES(?,?,?,?,0,?)',
            )
            .run(id, at, status, Date.now() - at, error);
          s.log('error', 'database_query_failed', p.id, { execution: id, code: error, status });
          if (
            !config.retry ||
            retry >= config.maxRetries ||
            ![429, 500, 502, 503, 504].includes(fault.status)
          )
            break;
          const delay = retryDelay(retry, fault.retryAfter);
          // Never sleep a worker indefinitely; preserve provider cooldown and try on the next run.
          if (delay > 60_000) break;
          s.log('info', 'retry_scheduled', p.id, { delayMs: Math.ceil(delay), attempt: retry + 1 });
          try {
            await wait(delay, undefined, { signal: this.abort.signal });
          } catch {
            error = 'EXECUTION_STOPPED';
            break;
          }
        }
      }
      if (error) break;
    }
    const ok = successes === config.requests && !error;
    s.db.transaction(() => {
      s.db
        .prepare(
          'UPDATE executions SET state=?,finished=?,requests=?,successes=?,database_ok=?,error=?,duration=? WHERE id=?',
        )
        .run(
          ok ? 'success' : 'failed',
          Date.now(),
          attempts,
          successes,
          Number(successes > 0),
          error,
          Date.now() - start,
          id,
        );
      s.db
        .prepare(
          'UPDATE projects SET last_run=?,last_success=CASE WHEN ? THEN ? ELSE last_success END,last_error=? WHERE id=?',
        )
        .run(Date.now(), Number(successes > 0), Date.now(), error, p.id);
    })();
  }
  async disconnect() {
    const s = this.api.store,
      enabled = s.settings().enabled;
    s.set('monitoring', { ...s.settings(), enabled: false });
    try {
      await Promise.allSettled(this.active.values());
      while (this.syncing) await wait(20);
      return await this.api.disconnect();
    } finally {
      s.set('monitoring', { ...s.settings(), enabled });
    }
  }
  async stop() {
    this.stopping = true;
    this.abort.abort();
    clearInterval(this.timer);
    await Promise.allSettled(this.active.values());
    while (this.syncing) await wait(20);
  }
}
