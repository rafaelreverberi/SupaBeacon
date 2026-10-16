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
