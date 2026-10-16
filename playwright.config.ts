import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'apps/web/tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:8189', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --import tsx apps/server/tests/browser-server.ts',
    url: 'http://localhost:8189/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
