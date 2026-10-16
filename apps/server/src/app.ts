import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import serveStatic from '@fastify/static';
import argon2 from 'argon2';
import { z } from 'zod';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { DateTime } from 'luxon';
import {
  settingsSchema,
  projectPatch,
  activityPatchSchema,
  type Execution,
} from '../../../packages/shared/config.js';
import { Store } from './storage.js';
import { random, digest, equal, vault } from './crypto.js';
import { Supabase, Discovery, ServiceError, type Transport } from './supabase.js';
import { Engine } from './engine.js';
import { validOrigin } from './origin.js';
import { activitySchema } from './activity-schema.js';
export interface AppConfig {
  database: string;
  key: string;
  origin: string;
  setupToken: string;
  trustProxy?: string;
  initial?: Record<string, unknown>;
}
export function callbackAllowed(origin: string) {
  const u = new URL(origin);
  return u.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}
const credentials = z
  .object({
    username: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-zA-Z0-9_.@-]+$/),
    password: z.string().min(12).max(128),
  })
  .strict();
const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  search: z.string().max(200).default(''),
  level: z.enum(['', 'debug', 'info', 'warning', 'error']).default(''),
  project: z.string().max(30).default(''),
  from: z.coerce.number().nonnegative().default(0),
  to: z.coerce.number().nonnegative().default(8640000000000000),
});
export async function createApp(config: AppConfig, transport?: Transport) {
  const origin = validOrigin(config.origin),
    secure = origin.startsWith('https:');
  const s = new Store(config.database, config.initial),
    box = vault(config.key),
    api = new Supabase(s, box, transport),
    discovery = new Discovery(api),
    engine = new Engine(api, discovery, config.key);
  const app = Fastify({
    logger: {
      level: 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
    },
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: config.trustProxy || false,
    bodyLimit: 16_384,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: secure ? [] : null,
      },
    },
    hsts: secure ? undefined : false,
  });
  await app.register(rateLimit, { global: false });
  const publicPaths = new Set([
    '/api/health',
    '/api/auth/status',
    '/api/auth/login',
    '/api/auth/setup',
  ]);
  const getSession = (req: { cookies: Record<string, string | undefined> }) => {
    const raw = req.cookies.sb_session;
    if (!raw) return undefined;
    return s.db
      .prepare('SELECT * FROM sessions WHERE id=? AND expires>?')
      .get(digest(raw), Date.now()) as
      { id: string; csrf: string; created: number; expires: number } | undefined;
  };
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const path = req.url.split('?')[0];
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin !== origin) throw new ServiceError('ORIGIN_REJECTED', 403);
      if (!publicPaths.has(path)) {
        const session = getSession(req);
        if (!session || !equal(String(req.headers['x-csrf-token'] ?? ''), session.csrf))
          throw new ServiceError('CSRF_REJECTED', 403);
      }
    }
    if (!publicPaths.has(path) && !getSession(req)) throw new ServiceError('AUTH_REQUIRED', 401);
  });
  app.setErrorHandler((error, req, reply) => {
    const status =
      error instanceof ServiceError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : error instanceof Error &&
              'statusCode' in error &&
              typeof error.statusCode === 'number' &&
              error.statusCode < 500
            ? error.statusCode
            : 500;
    const code =
      error instanceof ServiceError
        ? error.code
        : error instanceof z.ZodError
          ? 'VALIDATION_ERROR'
          : status === 429
            ? 'TOO_MANY_REQUESTS'
            : status === 500
              ? 'INTERNAL_ERROR'
              : 'BAD_REQUEST';
    if (status >= 500) app.log.error({ code, path: req.routeOptions.url }, 'Request failed');
    reply.code(status).send({
      error: {
        code,
        message: code.replaceAll('_', ' ').toLowerCase(),
        ...(error instanceof z.ZodError
          ? { fields: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }
          : {}),
      },
    });
  });
  const newSession = (reply: {
    setCookie: (name: string, value: string, options: object) => unknown;
  }) => {
    const raw = random(),
      csrf = random(),
      now = Date.now();
    s.db
      .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
      .run(digest(raw), csrf, now, now + 7 * 86400_000);
    reply.setCookie('sb_session', raw, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 86400,
    });
    return { authenticated: true, csrf };
  };
  app.get('/api/health', async (_req, reply) => {
    try {
      s.db.prepare('SELECT 1').get();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unhealthy' });
    }
  });
  app.get('/api/auth/status', async (req) => {
    const session = getSession(req);
    return {
      authenticated: !!session,
      setupRequired: !s.db.prepare('SELECT 1 FROM admin').get(),
      csrf: session?.csrf,
      username: session
        ? (s.db.prepare('SELECT username FROM admin').get() as { username: string }).username
        : undefined,
    };
  });
  app.post(
    '/api/auth/setup',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      if (s.db.prepare('SELECT 1 FROM admin').get()) throw new ServiceError('SETUP_COMPLETE', 409);
      const input = credentials.extend({ setupToken: z.string().min(32).max(128) }).parse(req.body);
      if (!config.setupToken || !equal(input.setupToken, config.setupToken))
        throw new ServiceError('INVALID_SETUP_TOKEN', 403);
      const password = await argon2.hash(input.password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      });
      // Unique singleton row prevents concurrent first-run account takeover.
      s.db.prepare('INSERT INTO admin VALUES(1,?,?)').run(input.username, password);
      s.log('info', 'administrator_created');
      return newSession(reply);
    },
  );
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const input = credentials.parse(req.body),
        admin = s.db.prepare('SELECT * FROM admin').get() as
          { username: string; password: string } | undefined;
      if (
        !admin ||
        !(await argon2.verify(admin.password, input.password)) ||
        !equal(input.username, admin.username)
      ) {
        s.log('warning', 'login_rejected');
        throw new ServiceError('INVALID_CREDENTIALS', 401);
      }
      s.log('info', 'administrator_signed_in');
      return newSession(reply);
    },
  );
  app.post('/api/auth/logout', async (req, reply) => {
    s.db.prepare('DELETE FROM sessions WHERE id=?').run(getSession(req)!.id);
    reply.clearCookie('sb_session', { path: '/' });
    return { ok: true };
  });
  app.post('/api/auth/password', async (req) => {
    const input = z
      .object({ current: z.string().max(128), password: credentials.shape.password })
      .parse(req.body);
    const admin = s.db.prepare('SELECT password FROM admin').get() as { password: string };
    if (!(await argon2.verify(admin.password, input.current)))
      throw new ServiceError('INVALID_CREDENTIALS', 401);
    const hash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    s.db.transaction(() => {
      s.db.prepare('UPDATE admin SET password=?').run(hash);
      s.db.prepare('DELETE FROM sessions WHERE id!=?').run(getSession(req)!.id);
    })();
    s.log('info', 'password_changed');
    return { ok: true };
  });
  app.get('/api/auth/sessions', async (req) => ({
    items: (
      s.db.prepare('SELECT id,created,expires FROM sessions WHERE expires>?').all(Date.now()) as {
        id: string;
      }[]
    ).map((v) => ({ ...v, current: v.id === getSession(req)!.id })),
  }));
  app.delete('/api/auth/sessions/:id', async (req) => {
    const { id } = z.object({ id: z.string().max(60) }).parse(req.params);
    s.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
    s.log('info', 'session_revoked');
    return { ok: true };
  });
  app.get('/api/oauth/status', async () => ({
    ...api.status(),
    callback: `${origin}/api/oauth/callback`,
    callbackAllowed: callbackAllowed(origin),
  }));
  app.put('/api/oauth/config', async (req) => {
    const c = z
      .object({
        clientId: z.uuid(),
        clientSecret: z.string().min(8).max(1000),
        dataEnabled: z.boolean(),
      })
      .strict()
      .parse(req.body);
    if (api.tokens()) throw new ServiceError('DISCONNECT_BEFORE_CHANGING_OAUTH', 409);
    if (!callbackAllowed(origin)) throw new ServiceError('HTTPS_REQUIRED_FOR_LAN_CALLBACK', 400);
    s.set('oauth_config', box.seal(c));
    s.log('info', 'oauth_configuration_changed');
    return { ok: true };
  });
  app.post('/api/oauth/connect', async (req) => {
    const c = api.config();
    if (!c) throw new ServiceError('OAUTH_NOT_CONFIGURED');
    if (!callbackAllowed(origin)) throw new ServiceError('HTTPS_REQUIRED_FOR_LAN_CALLBACK');
    const state = random(),
      verifier = random(),
      session = getSession(req)!;
    s.db.prepare('DELETE FROM oauth_flow WHERE session=?').run(session.id);
    s.db
      .prepare('INSERT INTO oauth_flow VALUES(?,?,?,?)')
      .run(digest(state), session.id, box.seal(verifier), Date.now() + 600_000);
    const url = new URL('https://api.supabase.com/v1/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: c.clientId,
      response_type: 'code',
      redirect_uri: `${origin}/api/oauth/callback`,
      state,
      code_challenge: digest(verifier),
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString() };
  });
  app.get('/api/oauth/callback', async (req, reply) => {
    const q = z
      .object({
        state: z.string().max(100),
        code: z.string().max(4096).optional(),
        error: z.string().max(200).optional(),
      })
      .parse(req.query);
    const flow = s.db
      .prepare(
        'DELETE FROM oauth_flow WHERE state=? AND session=? AND expires>? RETURNING verifier',
      )
      .get(digest(q.state), getSession(req)!.id, Date.now()) as { verifier: string } | undefined;
    if (!flow) throw new ServiceError('INVALID_OAUTH_STATE', 400);
    if (q.error || !q.code) return reply.redirect('/?oauth=denied#/settings');
    await api.exchange(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: q.code,
        redirect_uri: `${origin}/api/oauth/callback`,
        code_verifier: box.open<string>(flow.verifier),
      }),
    );
    s.log('info', 'oauth_connection_established');
    try {
      await discovery.sync();
      engine.reschedule();
    } catch {
      /* persisted sync error is surfaced by status */
    }
    return reply.redirect('/#/');
  });
  app.post('/api/oauth/disconnect', async () => {
    return await engine.disconnect();
  });
  app.get('/api/projects', async () => ({ items: s.projects() }));
  app.post(
    '/api/projects/:id/activity-schema',
    {
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { id } = z.object({ id: z.string().regex(/^[a-z]{20}$/) }).parse(req.params);
      const p = s.project(id);
      if (!p?.present) throw new ServiceError('PROJECT_NOT_FOUND', 404);
      return activitySchema(api, id);
    },
  );
  app.post('/api/projects/sync', async () => {
    await discovery.sync();
    for (const p of s.projects()) engine.plan(p);
    return { items: s.projects() };
  });
  app.get('/api/projects/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const p = s.project(id);
    if (!p) throw new ServiceError('PROJECT_NOT_FOUND', 404);
    return { ...p, effective: engine.config(p) };
  });
  function saveActivity(id: string, activityId: string, a: z.infer<typeof activityPatchSchema>) {
    const p = s.project(id)!;
    const existing = p.activities.find((a) => a.id === activityId);
    if (!existing && p.activities.length >= 8)
      throw new ServiceError('ACTIVITY_LIMIT_REACHED', 409);
    if (a.acknowledgeSessionReview && engine.isRunning(id))
      throw new ServiceError('PROJECT_ALREADY_RUNNING', 409);
    if (a.enabled) {
      if (engine.isRunning(id)) throw new ServiceError('PROJECT_ALREADY_RUNNING', 409);
      if (!api.config()?.dataEnabled) throw new ServiceError('DATA_STRATEGY_NOT_AUTHORIZED');
      if (!a.table || !a.column) throw new ServiceError('ACTIVITY_TABLE_AND_COLUMN_REQUIRED');
      if (a.mode === 'test-sign-in') {
        if (existing?.signInError && !a.testAccount)
          throw new ServiceError('TEST_ACCOUNT_UPDATE_REQUIRED', 409);
        const hasCredentials =
          a.testAccount === null ? false : !!a.testAccount || !!s.activitySecret(id, activityId);
        if (!hasCredentials) throw new ServiceError('TEST_ACCOUNT_REQUIRED');
        if (existing?.sessionReviewRequired && !a.acknowledgeSessionReview)
          throw new ServiceError('TEST_SESSION_REVIEW_REQUIRED', 409);
      }
    }
    s.db.transaction(() => {
      const credentials =
        a.testAccount === undefined
          ? s.activitySecret(id, activityId)
          : a.testAccount === null
            ? null
            : box.seal({ email: a.testAccount.email, password: a.testAccount.password });
      s.db
        .prepare(
          `INSERT INTO project_activity(project_id,id,name,enabled,mode,table_name,column_name,reads,credentials) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,mode=excluded.mode,table_name=excluded.table_name,column_name=excluded.column_name,reads=excluded.reads,credentials=excluded.credentials`,
        )
        .run(
          id,
          activityId,
          a.name ?? existing?.name ?? 'Additional activity',
          Number(a.enabled),
          a.mode,
          a.table,
          a.column,
          a.reads,
          credentials,
        );
      if (a.testAccount !== undefined)
        s.db
          .prepare('UPDATE project_activity SET sign_in_error=NULL WHERE project_id=? AND id=?')
          .run(id, activityId);
      if (a.acknowledgeSessionReview) {
        s.db
          .prepare('UPDATE project_activity SET session_review=0 WHERE project_id=? AND id=?')
          .run(id, activityId);
        s.log('warning', 'test_session_review_acknowledged', id, { activity: activityId });
      }
      s.log('info', 'optional_activity_configured', id, {
        activity: activityId,
        enabled: a.enabled,
        mode: a.mode,
        reads: a.reads,
      });
    })();
  }
  const activityParams = z.object({
    id: z.string().regex(/^[a-z]{20}$/),
    activityId: z.string().regex(/^(default|[a-f0-9-]{36})$/),
  });
  app.post('/api/projects/:id/activities', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const p = s.project(id);
    if (!p?.present) throw new ServiceError('PROJECT_NOT_FOUND', 404);
    if (engine.isRunning(id)) throw new ServiceError('PROJECT_ALREADY_RUNNING', 409);
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        mode: z.enum(['public-read', 'test-sign-in']).default('public-read'),
      })
      .strict()
      .parse(req.body);
    const activityId = crypto.randomUUID();
    saveActivity(id, activityId, { ...input, enabled: false, table: null, column: null, reads: 1 });
    return reply.code(201).send(s.project(id)!.activities.find((a) => a.id === activityId));
  });
  app.patch('/api/projects/:id/activities/:activityId', async (req) => {
    const { id, activityId } = activityParams.parse(req.params);
    if (!s.project(id)?.activities.some((a) => a.id === activityId))
      throw new ServiceError('ACTIVITY_NOT_FOUND', 404);
    saveActivity(id, activityId, activityPatchSchema.parse(req.body));
    return s.project(id)!.activities.find((a) => a.id === activityId);
  });
  app.delete('/api/projects/:id/activities/:activityId', async (req) => {
    const { id, activityId } = activityParams.parse(req.params);
    const a = s.project(id)?.activities.find((a) => a.id === activityId);
    if (!a) throw new ServiceError('ACTIVITY_NOT_FOUND', 404);
    if (engine.isRunning(id)) throw new ServiceError('PROJECT_ALREADY_RUNNING', 409);
    if (a.sessionReviewRequired) throw new ServiceError('TEST_SESSION_REVIEW_REQUIRED', 409);
    s.db.prepare('DELETE FROM project_activity WHERE project_id=? AND id=?').run(id, activityId);
    s.log('info', 'optional_activity_removed', id, { activity: activityId });
    return { ok: true };
  });
  app.patch('/api/projects/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params),
      input = projectPatch.parse(req.body),
      p = s.project(id);
    if (!p) throw new ServiceError('PROJECT_NOT_FOUND', 404);
    if (input.strategy === 'data' && !api.config()?.dataEnabled)
      throw new ServiceError('DATA_STRATEGY_NOT_AUTHORIZED');
    if (
      (input.strategy ?? p.strategy) === 'data' &&
      !(input.safeTable === undefined ? p.safe_table : input.safeTable)
    )
      throw new ServiceError('SAFE_TABLE_REQUIRED');
    s.db.transaction(() => {
      s.db
        .prepare('UPDATE projects SET enabled=?,overrides=?,strategy=?,safe_table=? WHERE id=?')
        .run(
          input.enabled === undefined ? p.enabled : Number(input.enabled),
          input.overrides === undefined
            ? p.overrides
            : input.overrides === null
              ? null
              : JSON.stringify(input.overrides),
          input.strategy ?? p.strategy,
          input.safeTable === undefined ? p.safe_table : input.safeTable,
          id,
        );
      if (input.activity) saveActivity(id, 'default', input.activity);
      s.db
        .prepare("UPDATE jobs SET state='cancelled' WHERE project_id=? AND state='pending'")
        .run(id);
      engine.plan(s.project(id)!);
      s.log('info', 'monitoring_settings_changed', id);
    })();
    return s.project(id);
  });
  app.post('/api/projects/:id/run', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return reply.code(202).send({ id: engine.run(id), state: 'running' });
  });
  function history(query: unknown) {
    const q = pagination.parse(query);
    const where = 'project_id LIKE ? AND started>=? AND started<=?';
    const args = [q.project || '%', q.from, q.to];
    return {
      items: s.db
        .prepare(`SELECT * FROM executions WHERE ${where} ORDER BY started DESC LIMIT 30 OFFSET ?`)
        .all(...args, (q.page - 1) * 30),
      total: (
        s.db.prepare(`SELECT count(*) AS n FROM executions WHERE ${where}`).get(...args) as {
          n: number;
        }
      ).n,
      page: q.page,
    };
  }
  app.get('/api/projects/:id/history', async (req) =>
    history({ ...(req.query as object), project: (req.params as { id: string }).id }),
  );
  app.get('/api/executions', async (req) => history(req.query));
  app.get('/api/executions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const e = s.db.prepare('SELECT * FROM executions WHERE id=?').get(id);
    if (!e) throw new ServiceError('EXECUTION_NOT_FOUND', 404);
    return {
      ...e,
      details: s.db
        .prepare('SELECT * FROM execution_requests WHERE execution_id=? ORDER BY at')
        .all(id),
    };
  });
  function logs(query: unknown, exporting = false) {
    const q = pagination.parse(query);
    const condition =
      "level LIKE ? AND coalesce(project_id,'') LIKE ? AND (event LIKE ? OR details LIKE ?) AND at>=? AND at<=?";
    const args = [q.level || '%', q.project || '%', `%${q.search}%`, `%${q.search}%`, q.from, q.to];
    return {
      items: s.db
        .prepare(`SELECT * FROM logs WHERE ${condition} ORDER BY id DESC LIMIT ? OFFSET ?`)
        .all(...args, exporting ? 10000 : 30, exporting ? 0 : (q.page - 1) * 30),
      total: (
        s.db.prepare(`SELECT count(*) AS n FROM logs WHERE ${condition}`).get(...args) as {
          n: number;
        }
      ).n,
      page: q.page,
    };
  }
  app.get('/api/logs', async (req) => logs(req.query));
  app.get('/api/logs/export', async (req, reply) =>
    reply
      .header('Content-Disposition', 'attachment; filename="supabeacon-logs.json"')
      .send(logs(req.query, true)),
  );
  app.get('/api/settings', async () => ({
    ...s.settings(),
    port: new URL(origin).port || (secure ? '443' : '80'),
    origin,
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    databaseHealth: s.db.pragma('quick_check', { simple: true }),
    deployment: 'Change DASHBOARD_PORT and APP_URL in .env, then recreate the container.',
  }));
  app.patch('/api/settings', async (req) => {
    const input = settingsSchema.parse(req.body);
    s.set('monitoring', input);
    engine.reschedule();
    s.log('info', 'monitoring_settings_changed');
    return input;
  });
  for (const action of ['pause', 'resume'])
    app.post(`/api/scheduler/${action}`, async () => {
      s.set('monitoring', { ...s.settings(), enabled: action === 'resume' });
      s.log('info', `scheduler_${action === 'resume' ? 'resumed' : 'paused'}`);
      return { enabled: action === 'resume' };
    });
  app.get('/api/diagnostics', async () => ({
    version: '1.0.0',
    node: process.version,
    uptime: Math.floor(process.uptime()),
    database: s.db.pragma('quick_check', { simple: true }),
    projects: s.projects().length,
    connection: api.status(),
    settings: s.settings(),
    pausingEffectiveness: 'unverified',
  }));
  app.get('/api/dashboard', async (req) => {
    const range = z
      .object({ days: z.coerce.number().int().min(7).max(30).default(7) })
      .parse(req.query).days;
    const now = Date.now(),
      config = s.settings(),
      today = DateTime.fromMillis(now, { zone: config.timezone }).startOf('day').toMillis();
    const projects = s.projects();
    const executions = s.db
      .prepare('SELECT * FROM executions WHERE started>=? ORDER BY started')
      .all(now - 31 * 86400_000) as Execution[];
    const recent = executions.filter((e) => e.started >= today);
    const chart = Array.from({ length: range }, (_, i) => {
      const day = DateTime.fromMillis(now, { zone: config.timezone })
        .startOf('day')
        .minus({ days: range - 1 - i });
      const rows = executions.filter(
        (e) => e.started >= day.toMillis() && e.started < day.plus({ days: 1 }).toMillis(),
      );
      return {
        date: day.toFormat('MMM dd'),
        success: rows.filter((e) => e.state === 'success').length,
        failed: rows.filter((e) => ['failed', 'interrupted'].includes(e.state)).length,
      };
    });
    return {
      projects,
      connection: api.status(),
      scheduler: config.enabled,
      uptime: Math.floor(process.uptime()),
      total: projects.filter((p) => p.present).length,
      enabled: projects.filter((p) => p.enabled && p.present).length,
      disabled: projects.filter((p) => !p.enabled && p.present).length,
      paused: projects.filter((p) => p.present && p.status === 'INACTIVE').length,
      successToday: recent.filter((e) => e.state === 'success').length,
      failedToday: recent.filter((e) => ['failed', 'interrupted'].includes(e.state)).length,
      requestsToday:
        recent.reduce((a, e) => a + e.requests, 0) +
        (
          s.db
            .prepare(
              "SELECT count(*) AS n FROM execution_requests WHERE kind='activity_read' AND at>=?",
            )
            .get(today) as { n: number }
        ).n,
      nextRun: Math.min(...projects.flatMap((p) => (p.next_run ? [p.next_run] : []))) || null,
      lastSuccess: Math.max(0, ...projects.map((p) => p.last_success ?? 0)) || null,
      chart,
    };
  });
  const web = resolve('dist/web');
  if (existsSync(web)) {
    await app.register(serveStatic, { root: web });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } })
        : reply.sendFile('index.html'),
    );
  }
  app.addHook('onClose', async () => {
    await engine.stop();
    s.db.close();
  });
  s.log('info', 'application_started');
  return { app, store: s, api, discovery, engine };
}
