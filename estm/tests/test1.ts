import { test, expect } from '@playwright/test';

test('login and close popup on eAuto staging', async ({ page }) => {
  // 1) Navigate to login page
  await page.goto('https://staging.eauto.my/sit2/public/login/');

  // 2) Fill credentials
  await page.getByRole('textbox', { name: 'Username' }).fill('nlim3');
  const password = process.env.EAUTO_PASSWORD || 'abcd1234';
  expect(password).toBeTruthy();
  await page.getByRole('textbox', { name: 'Password' }).fill(password);

  // 3) Submit login
  await page.getByRole('button', { name: 'Login' }).click();

  // 4) Wait for landing path
  await expect(page).toHaveURL(/\/sit2\/view\/ucd\/home.do/);
  await expect(page).toHaveTitle(/Welcome to eAuto/);

  // 5) Close popup if present
  const closeButton = page.locator('button:has-text("×"), text=×').first();
  if (await closeButton.isVisible()) {
    await closeButton.click();
    await expect(closeButton).toBeHidden();
  }

  // 6) Verify main UI
  await expect(page.getByRole('button', { name: 'HOME' })).toBeVisible();
});
