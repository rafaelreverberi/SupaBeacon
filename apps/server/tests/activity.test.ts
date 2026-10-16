import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';
import { createApp } from '../src/app.js';
import { vault } from '../src/crypto.js';
import { Store } from '../src/storage.js';
import { activitySchemaQuery } from '../src/activity-schema.js';
import type { Execution } from '../../../packages/shared/config.js';
const ref = 'abcdefghijklmnopqrst',
  ref2 = 'bbbbbbbbbbbbbbbbbbbb',
  key = 'c'.repeat(64),
  origin = 'http://localhost:8080';
const email = 'fixture-test-account@example.invalid',
  password = 'fixture-test-account-password',
  access = 'fixture-ephemeral-test-jwt',
  rowValue = 'fixture-selected-value-never-store';
const baseActivity = {
  enabled: true,
  mode: 'public-read' as 'public-read' | 'test-sign-in',
  table: 'healthcheck',
  column: 'id',
  reads: 1,
};
const account = { email, password, dedicated: true };
function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }, dataEnabled = true) {
  const dir = mkdtempSync(join(tmpdir(), 'supabeacon-activity-'));
  const state = {
    mode: 'ok',
    signIns: 0,
    signOuts: 0,
    reads: 0,
    afterSignIn: (() => {}) as () => void | Promise<void>,
    readAuthorization: [] as (string | undefined)[],
    urls: [] as string[],
  };
  const f = await createApp(
    { database: join(dir, 'test.db'), key, origin, setupToken: 'fixture-setup-'.repeat(4) },
    async (url, init) => {
      const u = String(url);
      state.urls.push(u);
      const project = (id: string) => ({
        id,
        name: 'Fixture',
        organization_id: 'fixture-org',
        region: 'eu-west-1',
        status: 'ACTIVE_HEALTHY',
      });
      if (u.endsWith('/v1/projects')) return response([project(ref), project(ref2)]);
      if (u.endsWith(`/v1/projects/${ref}`) || u.endsWith(`/v1/projects/${ref2}`))
        return response(project(u.split('/').at(-1)!));
      if (u.endsWith('/read-only') && String(init?.body).includes('information_schema.columns')) {
        assert.deepEqual(JSON.parse(String(init?.body)), { query: activitySchemaQuery });
        if (state.mode === 'schema-denied') return response({}, 403);
        if (state.mode === 'schema-invalid') return response([{ table_name: 'private.data' }]);
        if (state.mode === 'schema-large')
          return response(
            Array.from({ length: 2001 }, () => ({
              table_name: 'safe',
              column_name: 'id',
              data_type: 'uuid',
            })),
          );
        if (state.mode === 'schema-empty') return response([]);
        return response(
          [
            { table_name: 'healthcheck', column_name: 'id', data_type: 'uuid' },
            { table_name: 'healthcheck', column_name: 'counter', data_type: 'integer' },
            { table_name: 'other_table', column_name: 'total', data_type: 'integer' },
          ],
          201,
        );
      }
      if (u.endsWith('/read-only'))
        return state.mode === 'heartbeat-error'
          ? response({}, 503)
          : response([{ heartbeat: 1 }], 201);
      if (u.endsWith('/api-keys?reveal=false'))
        return response([
          { id: 'privileged-metadata', type: 'secret' },
          { id: 'public-fixture', type: 'publishable' },
        ]);
      if (u.endsWith('/api-keys/public-fixture?reveal=true'))
        return response({ type: 'publishable', api_key: 'sb_publishable_fixture' });
      if (u.endsWith('/auth/v1/token?grant_type=password')) {
        state.signIns++;
        assert.equal(init?.method, 'POST');
        assert.deepEqual(JSON.parse(String(init?.body)), { email, password });
        if (state.mode === 'sign-in-error')
          return response({ message: 'sensitive upstream rejection' }, 400);
        if (state.mode === 'network-signin') throw new Error('fixture-sensitive-transport-details');
        await state.afterSignIn();
        return response({
          access_token: access,
          refresh_token: 'fixture-discarded-refresh-token',
          user: { factors: state.mode === 'mfa' ? [{ status: 'verified' }] : [] },
        });
      }
      if (u.endsWith('/auth/v1/logout?scope=local')) {
        state.signOuts++;
        assert.equal(init?.method, 'POST');
        assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${access}`);
        return state.mode === 'signout-error' ? response({}, 503) : response(null, 204);
      }
      if (u.includes('.supabase.co/rest/v1/')) {
        state.reads++;
        assert.equal(init?.method, 'GET');
        assert.ok(u.endsWith('/healthcheck?select=id&limit=1'));
        state.readAuthorization.push((init?.headers as Record<string, string>).Authorization);
        if (state.mode === 'read-error')
          return response({ error: 'fixture-private-response' }, 403);
        if (state.mode === 'rate-limit') return response({}, 429, { 'Retry-After': '120' });
        if (state.mode === 'bad-body')
          return response([{ wrong_column: rowValue }], 200, { 'content-range': '0-0/*' });
        if (state.mode === 'huge-body')
          return response([{ id: 'x'.repeat(70000) }], 200, { 'content-range': '0-0/*' });
        return response([{ id: rowValue }], 200, { 'content-range': '0-0/*' });
      }
      throw new Error('Unexpected fixture URL');
    },
  );
  t.after(async () => {
    await f.app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await f.app.ready();
  const setup = await f.app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: { origin },
    payload: {
      setupToken: 'fixture-setup-'.repeat(4),
      username: 'testadmin',
      password: 'fixture-admin-password',
    },
  });
  assert.equal(setup.statusCode, 200);
  const headers = {
    origin,
    cookie: setup.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-csrf-token': setup.json().csrf as string,
  };
  f.store.set(
    'oauth_config',
    vault(key).seal({
      clientId: '11111111-1111-4111-8111-111111111111',
      clientSecret: 'fixture-oauth-secret',
      dataEnabled,
    }),
  );
  f.store.set(
    'oauth_tokens',
    vault(key).seal({
      access_token: 'fixture-management-access',
      refresh_token: 'fixture-management-refresh',
      expires_at: Date.now() + 3600000,
    }),
  );
  f.store.set('monitoring', { ...f.store.settings(), requests: 1 });
  await f.discovery.sync();
  const patch = (activity: unknown) =>
    f.app.inject({ method: 'PATCH', url: `/api/projects/${ref}`, headers, payload: { activity } });
  const run = async () => {
    const id = f.engine.run(ref);
    for (let n = 0; n < 300; n++) {
      const e = f.store.db.prepare('SELECT * FROM executions WHERE id=?').get(id) as Execution;
      if (e.state !== 'running') return e;
      await wait(10);
    }
    throw new Error('execution timed out');
  };
  return { ...f, headers, state, patch, run };
}
test('migration defaults existing and newly discovered projects to no optional traffic', async (t) => {
  const f = await fixture(t);
  assert.equal(f.store.project(ref)?.activity.enabled, false);
  assert.equal(f.store.project(ref2)?.activity.enabled, false);
  const e = await f.run();
  assert.equal(e.state, 'success');
  assert.equal(e.activity_state, 'disabled');
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.signIns, 0);
});
test('per-project public GET reads are bounded, respect anon access and discard selected values', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.patch({ ...baseActivity, reads: 3 })).statusCode, 200);
  const e = await f.run();
  assert.equal(e.state, 'success');
  assert.equal(e.requests, 1);
  assert.equal(e.activity_requests, 3);
  assert.equal(e.activity_reads, 3);
  assert.equal(e.activity_state, 'success');
  assert.equal(f.state.signIns, 0);
  assert.deepEqual(f.state.readAuthorization, [undefined, undefined, undefined]);
  assert.equal(f.store.project(ref2)?.activity.enabled, false);
  const rows = f.store.db
    .prepare(
      "SELECT kind,row_count FROM execution_requests WHERE execution_id=? AND kind='activity_read'",
    )
    .all(e.id);
  assert.equal(rows.length, 3);
  assert.ok(!f.store.db.serialize().includes(rowValue));
});
test('test account signs in once, reads with its JWT, signs out locally and stores no tokens/row contents', async (t) => {
  const f = await fixture(t);
  const saved = await f.patch({
    ...baseActivity,
    mode: 'test-sign-in',
    reads: 2,
    testAccount: account,
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().activity.credentialsConfigured, true);
  assert.ok(!saved.body.includes(email));
  assert.ok(!saved.body.includes(password));
  const e = await f.run();
  assert.equal(e.state, 'success');
  assert.equal(e.activity_requests, 4);
  assert.equal(e.activity_successes, 4);
  assert.equal(e.activity_reads, 2);
  assert.equal(f.state.signIns, 1);
  assert.equal(f.state.signOuts, 1);
  assert.deepEqual(f.state.readAuthorization, [`Bearer ${access}`, `Bearer ${access}`]);
  assert.equal(f.store.project(ref)?.activity.sessionReviewRequired, false);
  const output = await f.app.inject({ url: `/api/executions/${e.id}`, headers: f.headers });
  for (const secret of [email, password, access, rowValue, 'fixture-discarded-refresh-token']) {
    assert.ok(!f.store.db.serialize().includes(secret));
    assert.ok(!output.body.includes(secret));
  }
  assert.ok(f.store.activitySecret(ref));
  assert.ok(!f.state.urls.some((u) => /signup|admin|scope=global/.test(u)));
});
test('activity requires explicit Data API permission, safe identifiers and a confirmed dedicated account', async (t) => {
  const f = await fixture(t, false);
  assert.equal((await f.patch(baseActivity)).statusCode, 400);
  assert.equal((await f.patch({ ...baseActivity, enabled: false })).statusCode, 200);
  f.store.set('oauth_config', vault(key).seal({ ...f.api.config()!, dataEnabled: true }));
  for (const activity of [
    { ...baseActivity, table: 'http://evil.example' },
    { ...baseActivity, column: '*' },
    { ...baseActivity, reads: 4 },
    { ...baseActivity, mode: 'test-sign-in' },
    { ...baseActivity, mode: 'test-sign-in', testAccount: { ...account, dedicated: false } },
  ])
    assert.equal((await f.patch(activity)).statusCode, 400);
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: `/api/projects/${ref}`,
        headers: { ...f.headers, 'x-csrf-token': '' },
        payload: { activity: baseActivity },
      })
    ).statusCode,
    403,
  );
});
test('invalid test-account sign-in is recorded without retrying or reading', async (t) => {
  const f = await fixture(t);
  f.state.mode = 'sign-in-error';
  await f.patch({ ...baseActivity, mode: 'test-sign-in', testAccount: account });
  const e = await f.run();
  assert.equal(e.state, 'failed');
  assert.equal(e.activity_error, 'TEST_SIGN_IN_REJECTED');
  assert.equal(f.state.signIns, 1);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.signOuts, 0);
  assert.equal(f.store.project(ref)?.activity.sessionReviewRequired, false);
  assert.ok(!f.store.db.serialize().includes('sensitive upstream rejection'));
  await f.run();
  assert.equal(f.state.signIns, 1);
  assert.equal(f.store.project(ref)?.activity.signInError, 'TEST_SIGN_IN_REJECTED');
  f.state.mode = 'ok';
  assert.equal(
    (await f.patch({ ...baseActivity, mode: 'test-sign-in', testAccount: account })).statusCode,
    200,
  );
  assert.equal((await f.run()).state, 'success');
  assert.equal(f.state.signIns, 2);
});
test('a rejected read still cleans up the new session and preserves heartbeat database success', async (t) => {
  const f = await fixture(t);
  f.state.mode = 'read-error';
  await f.patch({ ...baseActivity, mode: 'test-sign-in', testAccount: account });
  const e = await f.run();
  assert.equal(e.state, 'failed');
  assert.equal(e.database_ok, 1);
  assert.equal(e.activity_error, 'ACTIVITY_READ_FAILED');
  assert.equal(f.state.signOuts, 1);
  assert.equal(f.store.project(ref)?.activity.sessionReviewRequired, false);
});
test('uncertain logout blocks later test sign-ins until explicit manual session review', async (t) => {
  const f = await fixture(t);
  f.state.mode = 'signout-error';
  await f.patch({ ...baseActivity, mode: 'test-sign-in', testAccount: account });
  const e = await f.run();
  assert.equal(e.activity_error, 'TEST_SESSION_REVIEW_REQUIRED');
  assert.equal(f.store.project(ref)?.activity.sessionReviewRequired, true);
  await f.run();
  assert.equal(f.state.signIns, 1);
  assert.equal((await f.patch({ ...baseActivity, mode: 'test-sign-in' })).statusCode, 409);
  f.state.mode = 'ok';
  assert.equal(
    (await f.patch({ ...baseActivity, mode: 'test-sign-in', acknowledgeSessionReview: true }))
      .statusCode,
    200,
  );
  assert.equal((await f.run()).state, 'success');
  assert.equal(f.state.signIns, 2);
});
test('lost sign-in response is treated as uncertain and does not create repeated sessions', async (t) => {
  const f = await fixture(t);
  f.state.mode = 'network-signin';
  await f.patch({ ...baseActivity, mode: 'test-sign-in', testAccount: account });
  await f.run();
  assert.equal(f.store.project(ref)?.activity.sessionReviewRequired, true);
  await f.run();
  assert.equal(f.state.signIns, 1);
  assert.ok(!f.store.db.serialize().includes('fixture-sensitive-transport-details'));
});
test('cleanup runs despite a persisted 429 cooldown from the optional read', async (t) => {
  const f = await fixture(t);
  f.state.mode = 'rate-limit';
  await f.patch({ ...baseActivity, mode: 'test-sign-in', testAccount: account });
  const e = await f.run();
  assert.equal(e.state, 'failed');
  assert.equal(f.state.signOuts, 1);
  assert.equal(f.store.project(ref)?.activity.sessionReviewRequired, false);
  assert.ok(f.store.get<number>('rate_until')! > Date.now());
});
test('global pause after sign-in skips extra reads but still signs the test session out', async (t) => {
  const f = await fixture(t);
  f.state.afterSignIn = () => f.store.set('monitoring', { ...f.store.settings(), enabled: false });
  await f.patch({ ...baseActivity, mode: 'test-sign-in', testAccount: account });
  const e = await f.run();
  assert.equal(e.activity_error, 'EXECUTION_STOPPED');
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.signOuts, 1);
  assert.equal(f.store.project(ref)?.activity.sessionReviewRequired, false);
});
test('unexpected or oversized data results are rejected and no returned values are persisted', async (t) => {
  const f = await fixture(t);
  await f.patch(baseActivity);
  f.state.mode = 'bad-body';
  assert.equal((await f.run()).activity_error, 'ACTIVITY_RESPONSE_INVALID');
  f.state.mode = 'huge-body';
  assert.equal((await f.run()).activity_error, 'ACTIVITY_RESPONSE_TOO_LARGE');
  assert.ok(!f.store.db.serialize().includes(rowValue));
});
test('test credentials can be retained or removed explicitly without exposing them', async (t) => {
  const f = await fixture(t);
  await f.patch({ ...baseActivity, mode: 'test-sign-in', testAccount: account });
  const encrypted = f.store.activitySecret(ref);
  await f.patch({ ...baseActivity, mode: 'test-sign-in', reads: 2 });
  assert.equal(f.store.activitySecret(ref), encrypted);
  await f.patch({ ...baseActivity, enabled: false, testAccount: null });
  assert.equal(f.store.activitySecret(ref), null);
  assert.equal(f.store.project(ref)?.activity.enabled, false);
  assert.equal(f.store.project(ref)?.activity.credentialsConfigured, false);
});
test('verified MFA factors are not automated and the issued low-assurance session is cleaned up', async (t) => {
  const f = await fixture(t);
  f.state.mode = 'mfa';
  await f.patch({ ...baseActivity, mode: 'test-sign-in', testAccount: account });
  const e = await f.run();
  assert.equal(e.activity_error, 'TEST_ACCOUNT_MFA_UNSUPPORTED');
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.signOuts, 1);
  assert.equal(f.store.project(ref)?.activity.sessionReviewRequired, false);
});

test('failed primary heartbeat skips all optional activity without an Auth attempt', async (t) => {
  const f = await fixture(t);
  f.state.mode = 'heartbeat-error';
  f.store.set('monitoring', { ...f.store.settings(), retry: false });
  await f.patch({ ...baseActivity, mode: 'test-sign-in', testAccount: account });
  const e = await f.run();
  assert.equal(e.activity_state, 'skipped');
  assert.equal(e.activity_error, 'HEARTBEAT_FAILED');
  assert.equal(e.activity_requests, 0);
  assert.equal(f.state.signIns, 0);
});
test('session-review state survives reopening SQLite and scheduler restart', async (t) => {
  const f = await fixture(t);
  await f.patch({ ...baseActivity, mode: 'test-sign-in', testAccount: account });
  f.store.db.prepare('UPDATE project_activity SET session_review=1 WHERE project_id=?').run(ref);
  const reopened = new Store(f.store.db.name);
  assert.equal(reopened.project(ref)?.activity.sessionReviewRequired, true);
  assert.equal(
    (
      reopened.db.prepare('SELECT count(*) AS n FROM migrations WHERE version=2').get() as {
        n: number;
      }
    ).n,
    1,
  );
  reopened.db.close();
  f.engine.start();
  const e = await f.run();
  assert.equal(e.activity_error, 'TEST_SESSION_REVIEW_REQUIRED');
  assert.equal(f.state.signIns, 0);
});
test('session acknowledgement cannot clear uncertainty while a sign-in is still in flight', async (t) => {
  const f = await fixture(t);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.state.afterSignIn = () => gate;
  await f.patch({ ...baseActivity, mode: 'test-sign-in', testAccount: account });
  const pending = f.run();
  try {
    for (let n = 0; n < 100 && f.state.signIns === 0; n++) await wait(10);
    assert.equal(f.store.project(ref)?.activity.sessionReviewRequired, true);
    assert.equal(
      (
        await f.patch({
          ...baseActivity,
          enabled: false,
          mode: 'test-sign-in',
          acknowledgeSessionReview: true,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (await f.patch({ ...baseActivity, enabled: false, mode: 'test-sign-in' })).statusCode,
      200,
    );
  } finally {
    release();
  }
  assert.equal((await pending).activity_error, 'EXECUTION_STOPPED');
  assert.equal(f.state.signOuts, 1);
  assert.equal(f.store.project(ref)?.activity.sessionReviewRequired, false);
});

test('schema picker uses fixed metadata-only query, independent of activity and Secrets Read', async (t) => {
  const f = await fixture(t, false);
  const r = await f.app.inject({
    method: 'POST',
    url: `/api/projects/${ref}/activity-schema`,
    headers: f.headers,
    payload: {},
  });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), {
    schema: 'public',
    tables: [
      {
        name: 'healthcheck',
        columns: [
          { name: 'id', type: 'uuid' },
          { name: 'counter', type: 'integer' },
        ],
      },
      { name: 'other_table', columns: [{ name: 'total', type: 'integer' }] },
    ],
  });
  assert.equal(f.store.project(ref)?.activity.enabled, false);
  assert.equal(f.state.signIns, 0);
  assert.equal(f.state.reads, 0);
  assert.ok(!f.state.urls.some((u) => u.includes('api-keys')));
  assert.equal(
    (f.store.db.prepare('SELECT count(*) AS n FROM executions').get() as { n: number }).n,
    0,
  );
});
test('schema picker requires session, CSRF and a present valid project', async (t) => {
  const f = await fixture(t);
  const url = `/api/projects/${ref}/activity-schema`;
  assert.equal(
    (await f.app.inject({ method: 'POST', url, headers: { origin }, payload: {} })).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url,
        headers: { origin, cookie: f.headers.cookie },
        payload: {},
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/projects/invalid/activity-schema',
        headers: f.headers,
        payload: {},
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `/api/projects/${'z'.repeat(20)}/activity-schema`,
        headers: f.headers,
        payload: {},
      })
    ).statusCode,
    404,
  );
  f.store.db.prepare('UPDATE projects SET present=0 WHERE id=?').run(ref);
  assert.equal(
    (await f.app.inject({ method: 'POST', url, headers: f.headers, payload: {} })).statusCode,
    404,
  );
});
test('schema picker surfaces denied/invalid/oversized schemas and legitimate empty metadata', async (t) => {
  const f = await fixture(t);
  for (const [mode, status] of [
    ['schema-denied', 403],
    ['schema-invalid', 502],
    ['schema-large', 422],
    ['schema-empty', 200],
  ] as const) {
    f.state.mode = mode;
    const r = await f.app.inject({
      method: 'POST',
      url: `/api/projects/${ref}/activity-schema`,
      headers: f.headers,
      payload: {},
    });
    assert.equal(r.statusCode, status);
    if (status === 200) assert.deepEqual(r.json(), { schema: 'public', tables: [] });
    else assert.ok(!r.body.includes('private.data'));
  }
});
