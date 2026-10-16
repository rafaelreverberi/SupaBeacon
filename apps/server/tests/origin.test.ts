import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicOrigin, validOrigin } from '../src/origin.js';
test('changing only DASHBOARD_PORT updates the direct HTTP origin including low ports', () => {
  assert.equal(
    resolvePublicOrigin({ appUrl: 'http://localhost:8080', dashboardPort: 84 }),
    'http://localhost:84',
  );
  assert.equal(
    resolvePublicOrigin({ appUrl: 'http://127.0.0.1:8080', dashboardPort: 18087 }),
    'http://127.0.0.1:18087',
  );
  assert.equal(
    resolvePublicOrigin({ appUrl: 'http://192.168.1.50:8080', dashboardPort: 84 }),
    'http://192.168.1.50:84',
  );
  assert.equal(
    resolvePublicOrigin({ appUrl: 'http://localhost:8080', dashboardPort: 80 }),
    'http://localhost',
  );
});
test('HTTPS proxy origin and explicit SSH or development origins stay stable', () => {
  assert.equal(
    resolvePublicOrigin({ appUrl: 'https://beacon.example.com', dashboardPort: 84 }),
    'https://beacon.example.com',
  );
  assert.equal(
    resolvePublicOrigin({ appUrl: 'https://beacon.example.com:8443', dashboardPort: 84 }),
    'https://beacon.example.com:8443',
  );
  assert.equal(
    resolvePublicOrigin({ appUrl: 'http://localhost:5173', dashboardPort: 8080, mode: 'explicit' }),
    'http://localhost:5173',
  );
  assert.equal(
    resolvePublicOrigin({ appUrl: 'http://localhost:8080', dashboardPort: 84, mode: 'explicit' }),
    'http://localhost:8080',
  );
  assert.equal(resolvePublicOrigin({ appUrl: 'http://localhost:84' }), 'http://localhost:84');
});
test('invalid redirect origins and host ports are rejected rather than inferred from request headers', () => {
  for (const url of [
    'https://user:pass@example.com',
    'http://localhost/path',
    'http://localhost?x=y',
    'http://localhost#x',
    'file:///tmp',
  ])
    assert.throws(() => validOrigin(url));
  for (const port of [0, -1, 65536, 1.5, NaN])
    assert.throws(() => resolvePublicOrigin({ dashboardPort: port }));
});
