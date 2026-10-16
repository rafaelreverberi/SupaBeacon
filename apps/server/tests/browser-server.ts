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
  async (url) => {
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
    if (u.endsWith('/read-only')) return Response.json([{ heartbeat: 1 }], { status: 201 });
    throw new Error('Unexpected test request');
  },
);
store.set(
  'oauth_config',
  vault(key).seal({
    clientId: '11111111-1111-4111-8111-111111111111',
    clientSecret: 'browser-fixture-only',
    dataEnabled: false,
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
