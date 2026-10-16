import { test, expect } from '@playwright/test';
const password = 'browser-fixture-password-1234';
test('protected onboarding, settings, project actions, history, logs, mobile and logout', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
  expect((await page.request.get('/api/projects')).status()).toBe(401);
  await page.getByLabel('One-time setup token').fill('browser-fixture-setup-token-0000000000');
  await page.getByLabel('Username', { exact: true }).fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Test project', exact: false }).first(),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Supabase integration', exact: true }).click();
  await expect(page.getByLabel('Callback URL', { exact: true })).toHaveValue(
    'http://localhost:8189/api/oauth/callback',
  );
  const logo = page.getByRole('link', { name: 'Download SupaBeacon logo' });
  await expect(logo).toHaveAttribute('href', '/branding/SupaBeacon_Logo.png');
  const logoResponse = await page.request.get('/branding/SupaBeacon_Logo.png');
  expect(logoResponse.status()).toBe(200);
  expect(logoResponse.headers()['content-type']).toContain('image/png');
  await expect(page.getByRole('img', { name: 'SupaBeacon OAuth application logo' })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/oauth-setup-desktop.png', fullPage: true });
  await page.getByRole('tab', { name: 'Monitoring', exact: true }).click();
  await page.getByLabel('Heartbeats per day').fill('3');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await page.reload();
  await page.getByRole('tab', { name: 'Monitoring', exact: true }).click();
  await expect(page.getByLabel('Heartbeats per day')).toHaveValue('3');
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Disable monitoring for Test project' }).click();
  await expect(
    page.getByRole('button', { name: 'Enable monitoring for Test project' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Enable monitoring for Test project' }).click();
  await page.getByRole('link', { name: 'Test project', exact: false }).first().click();
  await page.getByRole('button', { name: 'Run heartbeat / test connection' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Database operation succeeded' }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Succeeded', exact: true })).toBeVisible();
  await expect(page.locator('.run-result .badge')).toHaveText('success');
  await expect(page.getByLabel('Enable additional activity for this project')).not.toBeChecked();
  await page.getByLabel('Enable additional activity for this project').check();
  await page.route('**/activity-schema', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'project permission denied' } }),
    }),
  );
  await page.getByRole('button', { name: 'Load tables and columns', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load tables' })).toBeVisible();
  await page.getByLabel('Enter names manually', { exact: true }).check();
  await page.getByLabel('Activity table', { exact: true }).fill('healthcheck');
  await page.getByLabel('Safe column to read', { exact: true }).fill('id');
  await page.getByLabel('Enter names manually', { exact: true }).uncheck();
  await page.unroute('**/activity-schema');
  await page.getByRole('button', { name: 'Load tables and columns', exact: true }).click();
  await page.getByLabel('Activity table', { exact: true }).selectOption('other_table');
  await page.getByLabel('Safe column to read', { exact: true }).selectOption('total');
  await page.getByLabel('Activity table', { exact: true }).selectOption('healthcheck');
  await expect(page.getByLabel('Safe column to read', { exact: true })).toHaveValue('');
  await expect(
    page
      .getByLabel('Safe column to read', { exact: true })
      .getByRole('option', { name: 'total (integer)', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Safe column to read', { exact: true }).selectOption('id');
  await page.getByLabel('Additional reads per execution').fill('2');
  await page.getByRole('button', { name: 'Save optional activity', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Optional project activity saved' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Enable additional activity for this project')).toBeChecked();
  await page.getByRole('button', { name: 'Run heartbeat / test connection' }).click();
  await expect(page.locator('.run-result')).toContainText(
    'Additional activity: success · 2 reads · 2 HTTP requests',
  );
  await page.getByLabel('Additional activity mode').selectOption('test-sign-in');
  await page.getByLabel('Dedicated test-account email').fill('fixture-test@example.invalid');
  await page
    .getByLabel('Test-account password', { exact: true })
    .fill('fixture-browser-test-password');
  await page
    .getByRole('checkbox', {
      name: 'I confirm any newly entered credentials belong to a dedicated test account I control.',
    })
    .check();
  await page.getByRole('button', { name: 'Save optional activity', exact: true }).click();
  await expect(
    page.getByText('Test credentials are stored encrypted.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Test-account password', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Run heartbeat / test connection' }).click();
  await expect(page.locator('.run-result')).toContainText(
    'Additional activity: success · 2 reads · 4 HTTP requests',
  );
  await page
    .locator('.optional-activity')
    .screenshot({ path: 'test-results/optional-project-activity.png' });
  await page.getByRole('button', { name: 'Disable optional activity', exact: true }).click();
  await expect(page.getByLabel('Enable additional activity for this project')).not.toBeChecked();
  await page.getByRole('button', { name: 'Remove test credentials', exact: true }).click();
  await expect(page.getByText('No test credentials configured.', { exact: false })).toBeVisible();
  await page.locator('td .mono').first().click();
  await expect(page.getByRole('dialog', { name: 'Execution details' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Logs', exact: true }).click();
  await page.getByLabel('Search log events').fill('database_query_succeeded');
  await expect(page.locator('.log-event').first()).toContainText('database query succeeded');
  await page.locator('.log-event summary').first().click();
  await expect(page.getByRole('button', { name: 'Copy event details' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace health', exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Test project', exact: false }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator('.recharts-surface')
        .first()
        .evaluate((e) => e.getBoundingClientRect().width),
    )
    .toBeLessThan(391);
  await page.screenshot({ path: 'test-results/overview-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Username', { exact: true }).fill('testadmin');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password-long');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('invalid credentials');
  expect(errors).toEqual([]);
});
