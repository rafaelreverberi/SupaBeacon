// Explicit test-only server. Never imported by the production entrypoint.
import { createApp } from '../src/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vault } from '../src/crypto.js';
const dir = mkdtempSync(join(tmpdir(), 'supabeacon-browser-')),
  key = 'b'.repeat(64),
  ref = 'abcdefghijklmnopqrst';
const { app, store, engine } = await createApp(
  {
    database: join(dir, 'test.db'),
    key,
    origin: 'http://localhost:8189',
    setupToken: 'browser-fixture-setup-token-0000000000',
  },
  async (url, init) => {
    const u = String(url);
    const project = {
      id: ref,
      name: 'Test project',
      organization_id: 'Test organization',
      region: 'eu-central-1',
      status: 'ACTIVE_HEALTHY',
    };
    if (u.endsWith('/projects')) return Response.json([project]);
    if (u.endsWith(`/projects/${ref}`)) return Response.json(project);
    if (u.endsWith('/api-keys?reveal=false'))
      return Response.json([{ id: 'fixture-public', type: 'publishable' }]);
    if (u.endsWith('/api-keys/fixture-public?reveal=true'))
      return Response.json({ type: 'publishable', api_key: 'sb_publishable_fixture' });
    if (u.includes('/rest/v1/healthcheck?select=id&limit=1'))
      return Response.json([{ id: 'fixture-discarded-row' }], {
        headers: { 'content-range': '0-0/*' },
      });
    if (u.endsWith('/auth/v1/token?grant_type=password'))
      return Response.json({
        access_token: 'browser-fixture-auth-access',
        refresh_token: 'browser-fixture-auth-refresh',
        user: { factors: [] },
      });
    if (u.endsWith('/auth/v1/logout?scope=local')) return new Response(null, { status: 204 });
    if (u.endsWith('/read-only')) {
      if (String(init?.body).includes('information_schema.columns'))
        return Response.json(
          [
            { table_name: 'healthcheck', column_name: 'id', data_type: 'uuid' },
            { table_name: 'healthcheck', column_name: 'counter', data_type: 'integer' },
            { table_name: 'other_table', column_name: 'total', data_type: 'integer' },
          ],
          { status: 201 },
        );
      return Response.json([{ heartbeat: 1 }], { status: 201 });
    }
    throw new Error('Unexpected test request');
  },
);
store.set(
  'oauth_config',
  vault(key).seal({
    clientId: '11111111-1111-4111-8111-111111111111',
    clientSecret: 'browser-fixture-only',
    dataEnabled: true,
  }),
);
store.set(
  'oauth_tokens',
  vault(key).seal({
    access_token: 'browser-test-access',
    refresh_token: 'browser-test-refresh',
    expires_at: Date.now() + 86400000,
  }),
);
await app.listen({ port: 8189, host: '127.0.0.1' });
engine.start();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void app.close().then(() => {
      rmSync(dir, { recursive: true, force: true });
      process.exit(0);
    });
  });
