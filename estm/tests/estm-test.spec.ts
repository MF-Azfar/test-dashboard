import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://staging.eauto.my/sit2/public/login/');
  await page.getByRole('textbox', { name: 'Username ' }).fill('nlim3');
  await page.getByRole('textbox', { name: 'Username ' }).press('Tab');
  await page.getByRole('textbox', { name: 'Password ' }).fill('abcd1234');
  await page.getByRole('textbox', { name: 'Password ' }).press('Enter');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.locator('#dialog-raya-campaign').getByText('×').click();
  await page.getByRole('button', { name: 'eSERAHAN' }).click();
  await page.getByRole('button', { name: 'CREATE eSERAHAN TRANSACTION' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('link', { name: 'MALAYSIAN ( 马来西亚公民) ' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.locator('#vehicleRegNo').click();
  await page.locator('#vehicleRegNo').fill('WJJ8731a');
  await page.getByRole('textbox', { name: 'Email' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill('nicholas.lim@modefair.com');
  await page.locator('#buyer-consent').check();

  // wait for thumbprint verification to complete (adjust selector/text to match app UI)
  await page.waitForSelector('text=/thumbprint|biometric.*(success|verified)/i', { timeout: 30000 }).catch(() => {
    // fallback: maybe there is no explicit visible message in this environment
  });

  const nextButton = page.getByRole('button', { name: 'Next' });
  await expect(nextButton).toBeEnabled({ timeout: 30000 });
  await nextButton.click();

  await page.getByRole('textbox', { name: 'Reconfirm eVOC Email' }).click();
  await page.getByRole('textbox', { name: 'Reconfirm eVOC Email' }).fill('nicholas.lim@modefair.com');
  await page.getByRole('textbox', { name: 'Reconfirm eVOC Email' }).press('Tab');
  await page.getByRole('textbox', { name: 'Email Address' }).fill('n128314812@gmail.com');
  await page.getByRole('textbox', { name: 'Email Address' }).press('Tab');
  await page.getByRole('textbox', { name: 'Mobile No' }).fill('01293881238');
  await page.getByLabel('').check();
  await page.getByRole('textbox', { name: 'Engine No' }).click();
  await page.getByRole('textbox', { name: 'Engine No' }).fill('*/ -1231Aa');
  await page.getByRole('textbox', { name: 'Chassis No' }).click();
  await page.getByRole('textbox', { name: 'Chassis No' }).fill('913821AA/* --');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.locator('#ucd-consent').check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('#to-agree').check();
  await page.getByText('Next').click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.getByText('Make Payment').click();
  await page.getByRole('button', { name: 'Yes' }).click();
  await page.getByText('Next', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByText('Done').click();
  const page1Promise = page.waitForEvent('popup');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Invoice ' }).click();
  const page1 = await page1Promise;
  const download = await downloadPromise;
  const page2Promise = page.waitForEvent('popup');
  const download1Promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Slip Pengesahan ' }).click();
  const page2 = await page2Promise;
  const download1 = await download1Promise;
  await page.getByRole('link', { name: 'eSTM Transaction Listing' }).click();
  await page.getByRole('button', { name: 'Search Now ' }).click();
  await page.locator('b').nth(4).click();
  await page.getByTitle('to view E631940085').click();
  const page3Promise = page.waitForEvent('popup');
  const download2Promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'e-Invoice ' }).click();
  const page3 = await page3Promise;
  const download2 = await download2Promise;
  await page.getByText('Home / eSerahan / eSTM').click();
  await page.getByRole('button', { name: 'HOME' }).click();
});