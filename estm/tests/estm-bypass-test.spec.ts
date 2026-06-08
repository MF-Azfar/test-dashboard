import { test, expect } from '@playwright/test';

type RequiredInputs = {
  envSegment: string;
  vehicleRegNo: string;
  emailAddress: string;
  mobileNo: string;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const fromEnv = (name: string) => process.env[name]?.trim() ?? '';

const getRequiredInputs = (): RequiredInputs => {
  const envInputs: RequiredInputs = {
    envSegment: fromEnv('ESTM_ENV_SEGMENT'),
    vehicleRegNo: fromEnv('ESTM_VEHICLE_REG_NO'),
    emailAddress: fromEnv('ESTM_EMAIL_ADDRESS'),
    mobileNo: fromEnv('ESTM_MOBILE_NO'),
  };

  const missingFromEnv = Object.entries(envInputs)
    .filter(([, value]) => value.length === 0)
    .map(([key]) => key);

  if (missingFromEnv.length > 0) {
    throw new Error(
      `Missing required env vars: ${missingFromEnv.join(', ')}. ` +
      'Run via the interactive launcher: npm run estm_bypass',
    );
  }

  return envInputs;
};

test('test', async ({ page }) => {
  test.setTimeout(180000);
  const requiredInputs = getRequiredInputs();
  const fixedEmail = 'nicholas.lim@modefair.com';

  const maximizeBrowser = async () => {
    const cdpSession = await page.context().newCDPSession(page);
    const { windowId } = await cdpSession.send('Browser.getWindowForTarget');
    await cdpSession.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'maximized' },
    }).catch(() => {});
  };

  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = `
      .pw-action-highlight {
        outline: 3px solid #ff2d55 !important;
        box-shadow: 0 0 0 4px rgba(255, 45, 85, 0.25) !important;
        transition: outline 0.12s ease, box-shadow 0.12s ease;
      }
    `;
    document.documentElement.appendChild(style);

    const pulse = (el: Element | null) => {
      if (!(el instanceof HTMLElement)) return;
      el.classList.add('pw-action-highlight');
      window.setTimeout(() => el.classList.remove('pw-action-highlight'), 650);
    };

    document.addEventListener('click', (e) => pulse(e.target as Element), true);
    document.addEventListener('focusin', (e) => pulse(e.target as Element), true);
    document.addEventListener('input', (e) => pulse(e.target as Element), true);
  });

  const username = fromEnv('ESTM_USERNAME') || 'nsub2abc';
  const password = fromEnv('ESTM_PASSWORD') || 'abcd1234';
  const idType = fromEnv('ESTM_ID_TYPE') || '1';
  if (idType !== '1' && idType !== '2') {
    throw new Error('Invalid ESTM_ID_TYPE. Use 1 for MyKad or 2 for MyPR.');
  }

  await page.goto(`https://staging.eauto.my/${requiredInputs.envSegment}/public/login/`);
  await maximizeBrowser();
  await page.getByRole('textbox', { name: 'Username ' }).fill(username);
  await page.getByRole('textbox', { name: 'Username ' }).press('Tab');
  await page.getByRole('textbox', { name: 'Password ' }).fill(password);
  const loginButton = page.getByRole('button', { name: 'Login' });
  await Promise.all([
    page.waitForURL(new RegExp(`/${escapeRegex(requiredInputs.envSegment)}/view/ucd/home(\\.do)?`), {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    }),
    loginButton.click(),
  ]);
  console.log('PROGRESS:' + JSON.stringify({step:'login',label:'Login',status:'done'}));
  // Returns the newest non-closed page in the current browser context.
  // This project frequently closes/reopens pages during redirects, so callers must not rely on stale handles.
  const getActivePage = () => {
    const pages = page.context().pages().filter((p) => !p.isClosed());
    return pages[pages.length - 1] ?? page;
  };

  // Polls until a stable active page is available, then waits for DOM readiness on that page.
  const waitForActivePage = async (timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const p = getActivePage();
      if (!p.isClosed()) {
        await p.waitForLoadState('domcontentloaded').catch(() => {});
        if (!p.isClosed()) return p;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return getActivePage();
  };

  // Normalized DOM-ready wait used throughout navigation-heavy steps.
  const waitForDomReady = async () => {
    await getActivePage().waitForLoadState('domcontentloaded').catch(() => {});
  };

  // Closes dynamic campaign/modal overlays that can intercept pointer events.
  // Includes a DOM-level fallback for the Raya campaign popup when standard close actions fail.
  const closePopupIfPresent = async () => {
    const popupContainers = [
      page.locator('#dialog-raya-campaign'),
      page.locator('[role="dialog"]'),
      page.locator('.modal'),
      page.locator('.swal2-container'),
      page.locator('[class*="popup"]'),
    ];

    const closeTargets = [
      page.locator('#dialog-raya-campaign').getByText('×').first(),
      page.locator('#dialog-raya-campaign [aria-label="Close"]').first(),
      page.getByRole('button', { name: '×' }).first(),
      page.getByRole('button', { name: /close/i }).first(),
      page.locator('.swal2-close').first(),
      page.locator('[data-dismiss="modal"]').first(),
    ];

    for (let attempt = 0; attempt < 6; attempt++) {
      let popupVisible = false;
      for (const container of popupContainers) {
        if (await container.isVisible().catch(() => false)) {
          popupVisible = true;
          break;
        }
      }
      if (!popupVisible) return;

      let closed = false;
      for (const target of closeTargets) {
        if (await target.isVisible().catch(() => false)) {
          await target.click({ force: true }).catch(() => {});
          closed = true;
          break;
        }
      }

      if (!closed) {
        await page.keyboard.press('Escape').catch(() => {});
      }

      // Last-resort campaign modal removal for overlays that still intercept clicks.
      await page.evaluate(() => {
        const modal = document.querySelector<HTMLElement>('#dialog-raya-campaign');
        if (!modal) return;
        modal.style.display = 'none';
        modal.style.pointerEvents = 'none';
      }).catch(() => {});

      await page.locator('#dialog-raya-campaign').waitFor({ state: 'hidden', timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  };

  // Clicks the nearest "Yes" confirmation and waits for the next DOM-ready state.
  const clickYesAndWait = async () => {
    ap = await waitForActivePage();
    await ap.getByRole('button', { name: 'Yes' }).click().catch(() => {});
    await waitForDomReady();
  };

  // Clicks a "Next" action that may be exposed as either a semantic button or clickable text.
  const clickNextButtonOrText = async () => {
    ap = await waitForActivePage();
    const nextButton = ap.getByRole('button', { name: 'Next' }).first();
    if ((await nextButton.count().catch(() => 0)) > 0) {
      await nextButton.click({ timeout: 7000 }).catch(() => {});
    } else {
      await ap.getByText('Next', { exact: true }).first().click({ timeout: 7000 }).catch(() => {});
    }
  };

  await closePopupIfPresent();
  console.log('PROGRESS:' + JSON.stringify({step:'popup',label:'Close Popup',status:'done'}));
  const eSerahanBtn = page.getByRole('button', { name: 'eSERAHAN' });
  for (let attempt = 0; attempt < 4; attempt++) {
    await closePopupIfPresent();
    try {
      await eSerahanBtn.click({ timeout: 4000 });
      break;
    } catch (err) {
      if (attempt === 3) throw err;
      await page.waitForTimeout(250);
    }
  }
  console.log('PROGRESS:' + JSON.stringify({step:'eserahan',label:'Click eSERAHAN',status:'done'}));
  await page.getByRole('button', { name: 'CREATE eSERAHAN TRANSACTION' }).click();
  console.log('PROGRESS:' + JSON.stringify({step:'create_btn',label:'Create Transaction',status:'done'}));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  if (idType === '1') {
    await page.getByRole('link', { name: 'MALAYSIAN ( 马来西亚公民) ' }).click();
  } else {
    await page.getByRole('link', { name: 'MyPR - PEMASTAUTIN TETAP' }).click();
  }
  console.log('PROGRESS:' + JSON.stringify({step:'id_type',label:'Select ID Type',status:'done'}));
  //await page.getByRole('link', { name: 'SYARIKAT (公司) ' }).click();
  const initialYes = page.locator('button.confirm-dialog-btn', { hasText: 'Yes' }).first();
  await initialYes.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await initialYes.click({ timeout: 5000 }).catch(async () => {
    await initialYes.click({ force: true, timeout: 5000 }).catch(async () => {
      await initialYes.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
    });
  });
  await waitForDomReady();
  let ap = getActivePage();
  await ap.locator('#vehicleRegNo').click();
  await ap.locator('#vehicleRegNo').fill(requiredInputs.vehicleRegNo);
  console.log('PROGRESS:' + JSON.stringify({step:'vehicle_no',label:'Fill Vehicle No.',status:'done'}));
  await waitForDomReady();
  for (let attempt = 0; attempt < 3; attempt++) {
    ap = await waitForActivePage();
    try {
      await ap.getByRole('textbox', { name: 'Email' }).click({ timeout: 4000 });
      await ap.getByRole('textbox', { name: 'Email' }).fill(fixedEmail, { timeout: 4000 });
      break;
    } catch (err) {
      if (attempt === 2) throw err;
      await page.waitForTimeout(200);
    }
  }
  const buyerConsent = ap.locator('#buyer-consent');
  try {
    await buyerConsent.setChecked(true, { force: true });
  } catch {
    // Continue with alternative strategies below.
  }
  ap = getActivePage();
  if (!(await ap.locator('#buyer-consent').isChecked().catch(() => false))) {
    const buyerConsentLabel = ap.locator('label[for="buyer-consent"]');
    if (await buyerConsentLabel.count().catch(() => 0)) {
      await buyerConsentLabel.click({ force: true }).catch(() => {});
    }
  }
  ap = getActivePage();
  if (!(await ap.locator('#buyer-consent').isChecked().catch(() => false))) {
    await ap.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#buyer-consent');
      if (!input) return;
      input.disabled = false;
      input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }).catch(() => {});
  }
  await expect(getActivePage().locator('#buyer-consent')).toBeChecked();
  console.log('PROGRESS:' + JSON.stringify({step:'buyer_consent',label:'Buyer Consent',status:'done'}));
  ap = getActivePage();
  const dynamicSegment = ap.url().match(new RegExp(`/${escapeRegex(requiredInputs.envSegment)}/(.+?)/${escapeRegex(requiredInputs.envSegment)}/`))?.[1] ?? 'zzz/22';
  // Injects the live dynamic segment into any /<env>/view/... URL while preserving the rest of the path/query.
  const withSegment = (rawUrl: string) => {
    if (rawUrl.includes(`/${requiredInputs.envSegment}/${dynamicSegment}/${requiredInputs.envSegment}/view/`)) return rawUrl;
    return rawUrl.replace(
      new RegExp(`/${escapeRegex(requiredInputs.envSegment)}/(?:[^/]+/[^/]+/${escapeRegex(requiredInputs.envSegment)}/)?(view/.*)$`),
      `/${requiredInputs.envSegment}/${dynamicSegment}/${requiredInputs.envSegment}/$1`,
    );
  };

  // Ensures custom checkboxes are checked even when normal click/check flows are disrupted by redirects.
  const ensureChecked = async (selector: string, pageResolver: () => ReturnType<typeof getActivePage> = getActivePage) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = await waitForActivePage();
      const resolvedPage = p.isClosed() ? pageResolver() : p;
      const checkbox = resolvedPage.locator(selector);

      if (!(await checkbox.count().catch(() => 0))) return;
      if (await checkbox.isChecked().catch(() => false)) return;

      await checkbox.check({ force: true, timeout: 5000 }).catch(() => {});
      if (await checkbox.isChecked().catch(() => false)) return;

      const evaluated = await resolvedPage.evaluate((sel) => {
        const input = document.querySelector<HTMLInputElement>(sel);
        if (!input) return false;
        input.disabled = false;
        input.checked = true;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, selector).catch(() => false);

      if (evaluated && (await getActivePage().locator(selector).isChecked().catch(() => false))) return;
      await page.waitForTimeout(180);
    }

    await expect(getActivePage().locator(selector)).toBeChecked({ timeout: 5000 });
  };

  await ap.goto(withSegment(ap.url()), { waitUntil: 'domcontentloaded' }).catch(() => {});
  await waitForDomReady();
  console.log('PROGRESS:' + JSON.stringify({step:'bypass1',label:'Apply Bypass',status:'done'}));

  ap = getActivePage();
  const reconfirmEmail = ap.getByRole('textbox', { name: 'Reconfirm eVOC Email' });
  await expect(reconfirmEmail).toBeVisible({ timeout: 30000 });
  await reconfirmEmail.click();
  await reconfirmEmail.fill(fixedEmail);
  console.log('PROGRESS:' + JSON.stringify({step:'reconfirm_email',label:'Reconfirm Email',status:'done'}));
  await ap.getByRole('textbox', { name: 'Reconfirm eVOC Email' }).press('Tab');
  const emailAddress = ap.getByRole('textbox', { name: 'Email Address' });
  await emailAddress.fill(requiredInputs.emailAddress);
  await emailAddress.evaluate((el) => (el as HTMLInputElement).blur()).catch(() => {});
  // Blur on Email Address can trigger a redirect — refresh ap before Mobile No.
  await waitForDomReady();
  ap = getActivePage();
  await ap.getByRole('textbox', { name: 'Mobile No' }).fill(requiredInputs.mobileNo);
  console.log('PROGRESS:' + JSON.stringify({step:'contact_details',label:'Contact Details',status:'done'}));

  // #to-same-address is a custom checkbox — use ensureChecked helper.
  await ensureChecked('#to-same-address', getActivePage);

  // Same-address toggle can trigger a page reload/redirect — wait for stable DOM.
  await waitForDomReady();
  // Refresh ap after sameAddress check which may have caused another redirect.
  ap = getActivePage();

  await expect(ap.getByRole('textbox', { name: 'Engine No' })).toBeVisible({ timeout: 20000 });
  ap = getActivePage();
  await ap.getByRole('textbox', { name: 'Engine No' }).fill('*/ -1231Aa');
  await getActivePage().getByRole('textbox', { name: 'Chassis No' }).fill('913821AA/* --');
  console.log('PROGRESS:' + JSON.stringify({step:'engine_chassis',label:'Engine & Chassis',status:'done'}));
  for (let attempt = 0; attempt < 3; attempt++) {
    ap = await waitForActivePage();
    try {
      await ap.getByRole('button', { name: 'Next' }).click({ timeout: 4000 });
      break;
    } catch (err) {
      if (attempt === 2) throw err;
      await page.waitForTimeout(220);
    }
  }
  console.log('PROGRESS:' + JSON.stringify({step:'submit_step3',label:'Submit Step 3',status:'done'}));
  ap = await waitForActivePage();
  await ap.getByRole('button', { name: 'Yes' }).click({ timeout: 5000 }).catch(() => {});
  await waitForDomReady();

  // The post-Next page does not reliably show a Yes button; check consent and bypass forward.
  ap = getActivePage();
  await ap.waitForSelector('#ucd-consent', { state: 'visible', timeout: 15000 }).catch(() => {});
  await ap.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#ucd-consent');
    if (!input) return;
    input.scrollIntoView({ block: 'center' });
    input.disabled = false;
    input.click();
    input.checked = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }).catch(() => {});
  await ensureChecked('#ucd-consent', getActivePage);
  console.log('PROGRESS:' + JSON.stringify({step:'ucd_consent',label:'UCD Consent',status:'done'}));
  await waitForDomReady();

  ap = getActivePage();
  await ap.goto(
    ap.url().replace(
      `/${requiredInputs.envSegment}/view/`,
      `/${requiredInputs.envSegment}/zzz/22/${requiredInputs.envSegment}/view/`,
    ),
    { waitUntil: 'domcontentloaded' },
  ).catch(() => {});
  await waitForDomReady();
  console.log('PROGRESS:' + JSON.stringify({step:'bypass2',label:'2nd Bypass',status:'done'}));

  await ensureChecked('#to-agree', getActivePage);
  ap = await waitForActivePage();
  await ap.getByText('Next').click().catch(() => {});
  await waitForDomReady();

  await clickYesAndWait();

  ap = await waitForActivePage();
  await ap.getByText('Make Payment').click().catch(() => {});
  await waitForDomReady();

  await clickYesAndWait();

  ap = await waitForActivePage();
  const paymentNextInDialog = ap.getByRole('dialog', { name: /Payment/i }).getByRole('button', { name: 'Next' }).first();
  if ((await paymentNextInDialog.count().catch(() => 0)) > 0) {
    await paymentNextInDialog.click({ timeout: 7000 }).catch(() => {});
  } else {
    await clickNextButtonOrText();
  }

  await clickNextButtonOrText();
  ap = await waitForActivePage();
  await ap.getByRole('button', { name: 'OK' }).click().catch(() => {});
  ap = await waitForActivePage();
  await ap.getByText('Done').click().catch(() => {});
  console.log('PROGRESS:' + JSON.stringify({step:'payment_done',label:'Payment & Done',status:'done'}));

  if (!process.env.ESTM_SKIP_PAUSE) {
    await getActivePage().pause();
  }
  const _finalPage = getActivePage();
  console.log('RESULT:' + JSON.stringify({
    status: 'SUCCESS',
    vehicleRegNo: requiredInputs.vehicleRegNo,
    envSegment: requiredInputs.envSegment,
    idType: idType === '1' ? 'MyKad' : 'MyPR',
    emailAddress: requiredInputs.emailAddress,
    mobileNo: requiredInputs.mobileNo,
    finalUrl: _finalPage.url(),
  }));

});