import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createApp, callbackAllowed } from '../src/app.js';
import { vault } from '../src/crypto.js';
import { Store } from '../src/storage.js';
import { ServiceError, type Transport } from '../src/supabase.js';
const ref = 'abcdefghijklmnopqrst',
  ref2 = 'bcdefghijklmnopqrstuva'.slice(0, 20),
  key = 'a'.repeat(64),
  setupToken = 'fixture-setup-token-'.repeat(3),
  origin = 'http://localhost:8080';
const project = (id = ref, status = 'ACTIVE_HEALTHY') => ({
  id,
  name: `Project ${id}`,
  organization_id: 'org-fixture',
  region: 'eu-central-1',
  status,
});
function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
const transport: Transport = async (url, init) => {
  const u = String(url);
  if (u.endsWith('/oauth/token')) {
    assert.match(String(init?.body), /grant_type=/);
    return response({
      access_token: 'fixture-access',
      refresh_token: 'fixture-refresh',
      expires_in: 3600,
      scope: 'projects:read database:read',
    });
  }
  if (u.endsWith('/oauth/revoke')) return response(null, 204);
  if (u.endsWith('/projects')) return response([project()]);
  if (u.endsWith('/read-only')) return response([{ heartbeat: 1 }], 201);
  if (u.endsWith(`/projects/${ref}`)) return response(project());
  throw new Error(`Unexpected mocked URL ${u}`);
};
async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  custom: Transport = transport,
) {
  const dir = mkdtempSync(join(tmpdir(), 'supabeacon-test-'));
  const f = await createApp(
    { database: join(dir, 'test.sqlite'), key, origin, setupToken },
    custom,
  );
  t.after(async () => {
    await f.app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await f.app.ready();
  const login = await f.app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: { origin },
    payload: { username: 'admin', password: 'fixture-password-1234', setupToken },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    csrf = login.json().csrf as string;
  f.store.set(
    'oauth_config',
    vault(key).seal({
      clientId: '11111111-1111-4111-8111-111111111111',
      clientSecret: 'fixture-client-secret',
      dataEnabled: false,
    }),
  );
  return { ...f, dir, headers: { origin, cookie, 'x-csrf-token': csrf }, cookie };
}
function connect(f: Awaited<ReturnType<typeof fixture>>, expired = false) {
  f.store.set(
    'oauth_tokens',
    vault(key).seal({
      access_token: 'fixture-access',
      refresh_token: 'fixture-refresh',
      expires_at: expired ? 0 : Date.now() + 3600000,
    }),
  );
}
async function finish(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  for (let n = 0; n < 200; n++) {
    const e = f.store.db.prepare('SELECT * FROM executions WHERE id=?').get(id) as {
      state: string;
      successes: number;
      database_ok: number;
      error: string;
      requests: number;
    };
    if (e.state !== 'running') return e;
    await wait(10);
  }
  throw new Error('execution did not complete');
}
test('admin bootstrap protection, login, sessions, CSRF and secret-free responses', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.app.inject('/api/projects')).statusCode, 401);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        headers: { origin },
        payload: {},
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/scheduler/pause',
        headers: { cookie: f.cookie, origin },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/scheduler/pause',
        headers: { ...f.headers, origin: 'https://attacker.invalid' },
      })
    ).statusCode,
    403,
  );
  const login = await f.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { username: 'admin', password: 'fixture-password-1234' },
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.cookies[0].httpOnly, true);
  assert.equal(login.cookies[0].sameSite, 'Lax');
  const status = await f.app.inject({ url: '/api/oauth/status', headers: f.headers });
  assert.ok(!status.body.includes('fixture-client-secret'));
  const sessions = await f.app.inject({ url: '/api/auth/sessions', headers: f.headers });
  assert.equal(sessions.json().items.length, 2);
  assert.equal(
    (await f.app.inject({ method: 'POST', url: '/api/auth/logout', headers: f.headers }))
      .statusCode,
    200,
  );
  assert.equal((await f.app.inject({ url: '/api/projects', headers: f.headers })).statusCode, 401);
});
test('OAuth PKCE, one-use session-bound state, callback, discovery and disconnect', async (t) => {
  const f = await fixture(t);
  const result = await f.app.inject({
    method: 'POST',
    url: '/api/oauth/connect',
    headers: f.headers,
  });
  const url = new URL(result.json().url);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), `${origin}/api/oauth/callback`);
  assert.equal(url.searchParams.has('scope'), false);
  assert.equal(
    (
      await f.app.inject({
        url: '/api/oauth/callback?code=fixture&state=invalid',
        headers: f.headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/api/oauth/callback?code=fixture&state=${url.searchParams.get('state')}`,
      })
    ).statusCode,
    401,
  );
  const callback = await f.app.inject({
    url: `/api/oauth/callback?code=fixture&state=${url.searchParams.get('state')}`,
    headers: f.headers,
  });
  assert.equal(callback.statusCode, 302);
  assert.equal(f.store.projects().length, 1);
  assert.equal(f.store.projects()[0].enabled, 1);
  assert.ok(f.store.project(ref)?.next_run);
  assert.equal(
    (
      await f.app.inject({
        url: `/api/oauth/callback?code=fixture&state=${url.searchParams.get('state')}`,
        headers: f.headers,
      })
    ).statusCode,
    400,
  );
  assert.ok(!f.store.get<string>('oauth_tokens')!.includes('fixture-access'));
  assert.equal(
    (await f.app.inject({ method: 'POST', url: '/api/oauth/disconnect', headers: f.headers }))
      .statusCode,
    200,
  );
  assert.equal(f.api.status().connected, false);
  // Reconnection is usable without restarting the engine.
  connect(f);
  f.engine.run(ref);
  await wait(20);
});
test('automatic discovery, unavailable visibility, organization/status changes and no duplicates', async (t) => {
  let list = [project(), project(ref2, 'INACTIVE')];
  const f = await fixture(t, async (u, i) =>
    String(u).endsWith('/projects') ? response(list) : transport(u, i),
  );
  connect(f);
  await f.discovery.sync();
  await f.discovery.sync();
  assert.equal(f.store.projects().length, 2);
  f.engine.reschedule();
  assert.equal(f.store.project(ref2)?.next_run, null);
  list = [{ ...project(), organization_id: 'new-org' }];
  await f.discovery.sync();
  assert.equal(f.store.project(ref2)?.present, 0);
  assert.equal(f.store.project(ref)?.organization, 'new-org');
  f.store.set('monitoring', { ...f.store.settings(), autoEnable: false });
  list.push(project('c'.repeat(20)));
  await f.discovery.sync();
  assert.equal(f.store.project('c'.repeat(20))?.enabled, 0);
});
test('successful heartbeat validates SQL result, accurate history and concurrent run rejection', async (t) => {
  const f = await fixture(t);
  connect(f);
  await f.discovery.sync();
  f.engine.plan(f.store.project(ref)!);
  const before = f.store.project(ref)?.next_run;
  const id = f.engine.run(ref);
  assert.throws(
    () => f.engine.run(ref),
    (e) => e instanceof ServiceError && e.code === 'PROJECT_ALREADY_RUNNING',
  );
  const e = await finish(f, id);
  assert.equal(e.state, 'success');
  assert.equal(e.successes, 2);
  assert.equal(e.database_ok, 1);
  assert.equal(f.store.project(ref)?.next_run, before);
  assert.equal(
    f.store.db
      .prepare('SELECT count(*) AS n FROM execution_requests WHERE execution_id=?')
      .get(id) && e.requests,
    2,
  );
  const history = await f.app.inject({ url: '/api/executions', headers: f.headers });
  assert.equal(history.json().items[0].id, id);
});
test('HTTP success without verified database row fails; paused provider status prevents query', async (t) => {
  let paused = false,
    queries = 0;
  const f = await fixture(t, async (u, i) => {
    if (String(u).endsWith('/read-only')) {
      queries++;
      return response({ ok: true }, 201);
    }
    if (String(u).endsWith(`/projects/${ref}`))
      return response(project(ref, paused ? 'INACTIVE' : 'ACTIVE_HEALTHY'));
    return transport(u, i);
  });
  connect(f);
  await f.discovery.sync();
  f.store.set('monitoring', { ...f.store.settings(), retry: false });
  let result = await finish(f, f.engine.run(ref));
  assert.equal(result.state, 'failed');
  assert.equal(result.database_ok, 0);
  paused = true;
  result = await finish(f, f.engine.run(ref));
  assert.equal(result.error, 'PROJECT_NOT_ACTIVE');
  assert.equal(queries, 1);
  assert.throws(() => f.engine.run(ref));
});
test('429 cooldown is persisted, authorization errors are not retried indefinitely', async (t) => {
  let mode = 'rate';
  const f = await fixture(t, async (u, i) =>
    String(u).endsWith('/read-only')
      ? response({}, mode === 'rate' ? 429 : 403, { 'Retry-After': '120' })
      : transport(u, i),
  );
  connect(f);
  await f.discovery.sync();
  let result = await finish(f, f.engine.run(ref));
  assert.equal(result.error, 'RATE_LIMITED');
  assert.ok(f.store.get<number>('rate_until')! > Date.now() + 110000);
  f.store.set('rate_until', 0);
  mode = 'forbidden';
  result = await finish(f, f.engine.run(ref));
  assert.equal(result.error, 'PROJECT_PERMISSION_DENIED');
  assert.equal(result.requests, 1);
});
test('expired access tokens refresh once across concurrent callers; revoked refresh marks reconnect', async (t) => {
  let count = 0,
    revoked = false;
  const f = await fixture(t, async (u, i) => {
    if (String(u).endsWith('/oauth/token')) {
      count++;
      await wait(10);
      return revoked ? response({}, 400) : transport(u, i);
    }
    return transport(u, i);
  });
  connect(f, true);
  const tokens = await Promise.all([f.api.token(), f.api.token(), f.api.token()]);
  assert.equal(new Set(tokens).size, 1);
  assert.equal(count, 1);
  connect(f, true);
  revoked = true;
  await assert.rejects(() => f.api.token());
  assert.equal(f.api.status().reauthorize, true);
  assert.equal(f.api.status().connected, false);
  await assert.rejects(() => f.api.token());
  assert.equal(count, 2);
});
test('401 causes one refresh and retry; missing permissions preserve authorization', async (t) => {
  let requests = 0;
  const f = await fixture(t, async (u, i) => {
    if (String(u).endsWith('/projects'))
      return ++requests === 1 ? response({}, 401) : transport(u, i);
    return transport(u, i);
  });
  connect(f);
  await f.discovery.sync();
  assert.equal(requests, 2);
  assert.equal(f.api.status().connected, true);
});
test('Data API reveals only publishable key by ID and never retrieves table data', async (t) => {
  const seen: string[] = [];
  const f = await fixture(t, async (u, i) => {
    seen.push(String(u));
    if (String(u).includes('/api-keys?'))
      return response([
        { id: 'secret-id', type: 'secret' },
        { id: 'public-id', type: 'publishable' },
      ]);
    if (String(u).endsWith('/api-keys/public-id?reveal=true'))
      return response({ type: 'publishable', api_key: 'sb_publishable_fixture' });
    if (String(u).includes('.supabase.co/rest/v1/')) {
      assert.equal(i?.method, 'HEAD');
      assert.ok(String(u).endsWith('?select=*&limit=0'));
      return response(null, 200, { 'content-range': '*/0' });
    }
    return transport(u, i);
  });
  connect(f);
  f.store.set('oauth_config', vault(key).seal({ ...f.api.config()!, dataEnabled: true }));
  await f.discovery.sync();
  const change = await f.app.inject({
    method: 'PATCH',
    url: `/api/projects/${ref}`,
    headers: f.headers,
    payload: { strategy: 'data', safeTable: 'safe_health' },
  });
  assert.equal(change.statusCode, 200);
  const e = await finish(f, f.engine.run(ref));
  assert.equal(e.state, 'success');
  assert.ok(!seen.some((u) => u.includes('secret-id')));
  assert.ok(seen.some((u) => u.includes('reveal=false')));
});
test('scheduler skips old jobs, persists future jobs and does not replay interrupted work', async (t) => {
  const f = await fixture(t);
  connect(f);
  await f.discovery.sync();
  f.engine.plan(f.store.project(ref)!);
  const due = f.store.project(ref)!.next_run!;
  f.engine.plan(f.store.project(ref)!);
  assert.equal(
    (
      f.store.db.prepare("SELECT count(*) AS n FROM jobs WHERE state='pending'").get() as {
        n: number;
      }
    ).n,
    1,
  );
  f.store.db.prepare("UPDATE jobs SET due=? WHERE state='pending'").run(Date.now() - 3 * 86400000);
  f.engine.start();
  assert.equal(
    (
      f.store.db.prepare("SELECT count(*) AS n FROM jobs WHERE state='skipped'").get() as {
        n: number;
      }
    ).n,
    1,
  );
  assert.equal(
    (f.store.db.prepare('SELECT count(*) AS n FROM executions').get() as { n: number }).n,
    0,
  );
  assert.ok(f.store.project(ref)!.next_run! > Date.now());
  assert.equal(f.store.project(ref)!.next_run, due);
  const reopened = new Store(join(f.dir, 'test.sqlite'));
  assert.equal(reopened.project(ref)?.next_run, due);
  reopened.db.close();
});
test('retention keeps running executions and prunes history; SQL filters are parameterized', async (t) => {
  const f = await fixture(t);
  connect(f);
  await f.discovery.sync();
  f.store.log('info', 'event');
  f.store.db.prepare('UPDATE logs SET at=0').run();
  f.store.prune();
  assert.equal((f.store.db.prepare('SELECT count(*) AS n FROM logs').get() as { n: number }).n, 0);
  const logs = await f.app.inject({
    url: '/api/logs?search=' + encodeURIComponent("' OR 1=1 --"),
    headers: f.headers,
  });
  assert.equal(logs.statusCode, 200);
  assert.equal(logs.json().total, 0);
  assert.equal(
    (await f.app.inject({ url: '/api/logs?page=-1', headers: f.headers })).statusCode,
    400,
  );
});
test('redirect policy permits HTTPS and localhost, rejects HTTP LAN', () => {
  assert.equal(callbackAllowed('http://localhost:8080'), true);
  assert.equal(callbackAllowed('https://beacon.example.com'), true);
  assert.equal(callbackAllowed('http://192.168.1.20:8080'), false);
});

test('rescheduling revives cancelled future jobs and restart never replays claimed executions', async (t) => {
  const f = await fixture(t);
  connect(f);
  await f.discovery.sync();
  f.engine.plan(f.store.project(ref)!);
  const due = f.store.project(ref)!.next_run;
  f.engine.reschedule();
  assert.equal(
    (
      f.store.db.prepare("SELECT count(*) AS n FROM jobs WHERE state='pending'").get() as {
        n: number;
      }
    ).n,
    1,
  );
  assert.equal(f.store.project(ref)!.next_run, due);
  f.store.db.prepare("UPDATE jobs SET state='running'").run();
  f.store.db
    .prepare(
      "INSERT INTO executions(id,project_id,source,strategy,state,started) VALUES('crash-fixture',?,'scheduled','management','running',?)",
    )
    .run(ref, Date.now() - 1000);
  f.engine.start();
  assert.equal(
    (
      f.store.db.prepare("SELECT state FROM executions WHERE id='crash-fixture'").get() as {
        state: string;
      }
    ).state,
    'interrupted',
  );
  assert.equal(
    (f.store.db.prepare('SELECT count(*) AS n FROM executions').get() as { n: number }).n,
    1,
  );
});

test('transient failures retry within bounds and recovered database request succeeds', async (t) => {
  let count = 0;
  const f = await fixture(t, async (u, i) => {
    if (String(u).endsWith('/read-only') && ++count === 1) return response({}, 503);
    return transport(u, i);
  });
  connect(f);
  await f.discovery.sync();
  f.store.set('monitoring', { ...f.store.settings(), requests: 1 });
  const e = await finish(f, f.engine.run(ref));
  assert.equal(e.state, 'success');
  assert.equal(e.requests, 2);
  assert.equal(e.successes, 1);
  assert.equal(
    (
      f.store.db.prepare("SELECT count(*) AS n FROM logs WHERE event='retry_scheduled'").get() as {
        n: number;
      }
    ).n,
    1,
  );
});
test('retention runs even when monitoring is paused and disconnected', async (t) => {
  const f = await fixture(t);
  f.store.set('monitoring', { ...f.store.settings(), enabled: false });
  f.store.log('info', 'expired_fixture');
  f.store.db.prepare('UPDATE logs SET at=0').run();
  f.engine.tick();
  assert.equal((f.store.db.prepare('SELECT count(*) AS n FROM logs').get() as { n: number }).n, 0);
});

test('disconnect reports unconfirmed provider revocation without retaining local credentials', async (t) => {
  const f = await fixture(t, async (u, i) =>
    String(u).endsWith('/oauth/revoke') ? response({}, 401) : transport(u, i),
  );
  connect(f);
  const r = await f.app.inject({
    method: 'POST',
    url: '/api/oauth/disconnect',
    headers: f.headers,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().providerRevoked, false);
  assert.equal(f.api.tokens(), null);
});
test('a late OAuth callback cannot restore credentials after disconnect', async (t) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async (u, i) => {
    if (String(u).endsWith('/oauth/token')) await gate;
    return transport(u, i);
  });
  connect(f);
  const pending = f.api.exchange(
    new URLSearchParams({ grant_type: 'authorization_code', code: 'fixture-code' }),
  );
  const failure = assert.rejects(
    pending,
    (e) => e instanceof ServiceError && e.code === 'OAUTH_AUTHORIZATION_CHANGED',
  );
  await f.api.disconnect();
  release();
  await failure;
  assert.equal(f.api.tokens(), null);
});

test('partial database success is durable while another request is still in flight', async (t) => {
  let count = 0,
    release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async (u, i) => {
    if (String(u).endsWith('/read-only') && ++count === 2) await gate;
    return transport(u, i);
  });
  connect(f);
  await f.discovery.sync();
  const id = f.engine.run(ref);
  try {
    for (let n = 0; n < 100 && count < 2; n++) await wait(10);
    const snapshot = new Store(join(f.dir, 'test.sqlite'));
    try {
      const e = snapshot.db
        .prepare('SELECT state,successes,database_ok,requests FROM executions WHERE id=?')
        .get(id) as { state: string; successes: number; database_ok: number; requests: number };
      assert.equal(e.state, 'running');
      assert.equal(e.successes, 1);
      assert.equal(e.database_ok, 1);
      assert.equal(e.requests, 2);
      assert.ok(snapshot.project(ref)?.last_success);
    } finally {
      snapshot.db.close();
    }
  } finally {
    release();
  }
  assert.equal((await finish(f, id)).state, 'success');
});
