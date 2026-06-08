import { test, Page, Dialog } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const BASE_URL = process.env.INS_BASE_URL || 'https://staging.eauto.my/sit3';
const CONFIG = {
  baseUrl: BASE_URL,
  stagingLoginUrl: BASE_URL + '/public/login',
  enquiryPath: '/view/insurance/insurance-quote-enquiry/',
  username: process.env.INS_USERNAME || 'Jasons',
  password: process.env.INS_PASSWORD || 'eauTo!!2026!',
  icNumber: process.env.INS_IC || '020406081081',
  postcode: process.env.INS_POSTCODE || '31150',
  vehicleCategory: (process.env.INS_CATEGORY || 'individual').toLowerCase(),
  inputFile: process.env.INS_INPUT_FILE || './input-vehicles.xlsx',
  outputFile: process.env.INS_OUTPUT_FILE || './output-results.xlsx',
  navigationTimeout: 60000,
  waitAfterPageLoad: 3000,
  waitAfterClick: 5000,
  pollingInterval: 2000,
  maxWaitForResult: 60000,
};

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface VehicleInput {
  vehicleNumber: string;
  icNumber?: string;
  postcode?: string;
  vehicleCategory?: string;
}

interface InsurerResult {
  insurerName: string;
  coverType: string;
  allowToPurchase: string;
  referRiskCode: string;
  totalPrice: string;
}

interface VehicleResult {
  vehicleNumber: string;
  make: string;
  model: string;
  manufacturingYear: string;
  engineCapacity: string;
  transmission: string;
  variant: string;
  insurers: InsurerResult[];
  status: 'SUCCESS' | 'NO_VEHICLE_INFO' | 'ERROR';
  errorMessage?: string;
}

// ─── READ INPUT EXCEL ────────────────────────────────────────────────────────
async function readInputExcel(filePath: string): Promise<VehicleInput[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(1);
  if (!ws) throw new Error('No worksheet found');

  const vehicles: VehicleInput[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const vn = row.getCell(1).text?.toString().trim();
    if (!vn) return;
    vehicles.push({
      vehicleNumber: vn,
      icNumber: row.getCell(2).text?.toString().trim() || undefined,
      postcode: row.getCell(3).text?.toString().trim() || undefined,
      vehicleCategory: row.getCell(4).text?.toString().trim().toLowerCase() || undefined,
    });
  });
  return vehicles;
}

// ─── WRITE OUTPUT EXCEL ──────────────────────────────────────────────────────
async function writeOutputExcel(results: VehicleResult[], filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'eAuto Insurance Checker';
  wb.created = new Date();

  // Summary sheet
  const ss = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  ss.columns = [
    { header: 'Vehicle Number', key: 'vehicleNumber', width: 18 },
    { header: 'Make', key: 'make', width: 15 },
    { header: 'Model', key: 'model', width: 30 },
    { header: 'Mfg Year', key: 'mfgYear', width: 12 },
    { header: 'Engine CC', key: 'cc', width: 12 },
    { header: 'Transmission', key: 'transmission', width: 20 },
    { header: 'Variant', key: 'variant', width: 25 },
    { header: 'Insurer', key: 'insurer', width: 20 },
    { header: 'Cover Type', key: 'coverType', width: 35 },
    { header: 'Allow Purchase', key: 'allow', width: 16 },
    { header: 'Refer Risk Code', key: 'risk', width: 45 },
    { header: 'Total Price', key: 'price', width: 15 },
  ];
  ss.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ss.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
  ss.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

  for (const r of results) {
    if (r.status !== 'SUCCESS' || r.insurers.length === 0) continue;
    for (const ins of r.insurers) {
      const row = ss.addRow({
        vehicleNumber: r.vehicleNumber, make: r.make, model: r.model,
        mfgYear: r.manufacturingYear, cc: r.engineCapacity,
        transmission: r.transmission, variant: r.variant,
        insurer: ins.insurerName, coverType: ins.coverType,
        allow: ins.allowToPurchase, risk: ins.referRiskCode, price: ins.totalPrice,
      });
      const cell = row.getCell('allow');
      cell.font = ins.allowToPurchase === 'Yes'
        ? { color: { argb: 'FF008000' }, bold: true }
        : { color: { argb: 'FFFF0000' }, bold: true };
    }
  }
  if (ss.rowCount > 1) {
    ss.autoFilter = { from: { row: 1, column: 1 }, to: { row: ss.rowCount, column: 12 } };
  }

  // Skipped sheet
  const sk = wb.addWorksheet('Skipped Vehicles', { views: [{ state: 'frozen', ySplit: 1 }] });
  sk.columns = [
    { header: 'Vehicle Number', key: 'vn', width: 18 },
    { header: 'Status', key: 'st', width: 20 },
    { header: 'Reason', key: 'reason', width: 60 },
  ];
  sk.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sk.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };

  for (const r of results) {
    if (r.status === 'SUCCESS') continue;
    sk.addRow({ vn: r.vehicleNumber, st: r.status, reason: r.errorMessage || 'No info' });
  }

  await wb.xlsx.writeFile(filePath);
}

// ─── LOGIN ───────────────────────────────────────────────────────────────────
async function login(page: Page): Promise<void> {
  console.log('🔐 Logging in jappp...');

  await page.goto(CONFIG.stagingLoginUrl, { waitUntil: 'load', timeout: CONFIG.navigationTimeout });
  await page.waitForTimeout(CONFIG.waitAfterPageLoad);

  const url = page.url();
  console.log(`   Landed on: ${url}`);

  // Find login fields (works on both staging and production login pages)
  const userField = page.locator('input[name="username"], input[placeholder="Username"]').first();
  if ((await userField.count()) === 0) {
    console.log('   No login form — already logged in?');
    return;
  }

  const passField = page.locator('input[name="password"], input[placeholder="Password"]').first();
  const loginBtn = page.locator('button:has-text("Login"), input[type="submit"], button[type="submit"]').first();

  await userField.fill(CONFIG.username);
  await passField.fill(CONFIG.password);
  await loginBtn.click();
  await page.waitForLoadState('load', { timeout: CONFIG.navigationTimeout });
  await page.waitForTimeout(CONFIG.waitAfterPageLoad);
  console.log(`   Post-login: ${page.url()}`);

  // Navigate to enquiry page
  await page.goto(`${CONFIG.baseUrl}${CONFIG.enquiryPath}`, { waitUntil: 'load', timeout: CONFIG.navigationTimeout });
  await page.waitForTimeout(CONFIG.waitAfterPageLoad);

  // If redirected to login again, try logging in on whatever page we're on
  if (page.url().includes('/login')) {
    console.log('   Still on login — trying again on current page...');
    const u2 = page.locator('input[name="username"], input[placeholder="Username"]').first();
    if ((await u2.count()) > 0) {
      await u2.fill(CONFIG.username);
      await page.locator('input[name="password"], input[placeholder="Password"]').first().fill(CONFIG.password);
      await page.locator('button:has-text("Login"), input[type="submit"], button[type="submit"]').first().click();
      await page.waitForLoadState('load', { timeout: CONFIG.navigationTimeout });
      await page.waitForTimeout(CONFIG.waitAfterPageLoad);

      await page.goto(`${CONFIG.baseUrl}${CONFIG.enquiryPath}`, { waitUntil: 'load', timeout: CONFIG.navigationTimeout });
      await page.waitForTimeout(CONFIG.waitAfterPageLoad);
    }
  }

  console.log(`✅ Login done. URL: ${page.url()}`);
}

// ─── WAIT HELPERS ────────────────────────────────────────────────────────────

/** Poll until "Working..." text disappears from the page */
async function waitForWorkingDone(page: Page): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < CONFIG.maxWaitForResult) {
    const text = await page.locator('body').innerText().catch(() => '');
    if (!text.includes('Working...')) return;
    await page.waitForTimeout(CONFIG.pollingInterval);
  }
  console.log('   ⚠️ Timed out waiting for Working...');
}

/** Poll until a specific condition is true on the page */
async function waitForCondition(page: Page, checkFn: () => Promise<boolean>, maxWait: number = CONFIG.maxWaitForResult): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (await checkFn()) return true;
    await page.waitForTimeout(CONFIG.pollingInterval);
  }
  return false;
}

// ─── PROCESS ONE VEHICLE ─────────────────────────────────────────────────────
async function processVehicle(page: Page, vehicle: VehicleInput): Promise<VehicleResult> {
  const ic = vehicle.icNumber || CONFIG.icNumber;
  const postcode = vehicle.postcode || CONFIG.postcode;
  const category = (vehicle.vehicleCategory || CONFIG.vehicleCategory).toLowerCase();
  const vn = vehicle.vehicleNumber;

  const emptyResult = (status: 'NO_VEHICLE_INFO' | 'ERROR', msg: string): VehicleResult => ({
    vehicleNumber: vn, make: '', model: '', manufacturingYear: '',
    engineCapacity: '', transmission: '', variant: '', insurers: [],
    status, errorMessage: msg,
  });

  console.log(`\n🚗 Processing: ${vn}`);

  // Navigate fresh
  await page.goto(`${CONFIG.baseUrl}${CONFIG.enquiryPath}`, { waitUntil: 'load', timeout: CONFIG.navigationTimeout });
  await page.waitForTimeout(CONFIG.waitAfterPageLoad);

  // Check we're on the right page
  if (page.url().includes('/login')) {
    console.log('   Session expired, re-logging...');
    await login(page);
  }

  // Verify form exists
  const formExists = await page.locator('#quote-form').count();
  if (formExists === 0) {
    return emptyResult('ERROR', 'Enquiry form not found on page');
  }

  // ── Step 1: Fill form ──────────────────────────────────────────────
  if (category === 'company') {
    await page.locator('input[name="vehicleCategory"][value="company"]').check();
  }

  await page.locator('#vehicleRegNo').fill(vn);
  await page.locator('#buyerRefIdCompanyROC').fill(ic);

  // ── Step 2: Handle dialog (alert popup) ────────────────────────────
  // IMPORTANT: The form is AJAX-based. Clicking SHOW RESULT does NOT
  // cause a page navigation. It may trigger a JS alert() first.
  // We remove ALL existing dialog listeners first to prevent duplicates,
  // then add a single handler.
  page.removeAllListeners('dialog');
  let dialogMsg = '';
  const dialogHandler = async (dialog: Dialog) => {
    dialogMsg = dialog.message();
    console.log(`   📢 Alert: "${dialogMsg}"`);
    await dialog.accept();
  };
  page.on('dialog', dialogHandler);

  // ── Step 3: Click SHOW RESULT ──────────────────────────────────────
  // NO page.waitForLoadState here! The form is AJAX — no page nav happens.
  console.log('   Clicking SHOW RESULT...');
  await page.locator('#to-show-result').click();

  // Wait for: postcode field OR vehicle detail OR error message
  const gotResult = await waitForCondition(page, async () => {
    const text = await page.locator('body').innerText().catch(() => '');
    return !text.includes('Working...') ||
      text.includes('Unable to retrieve') ||
      (await page.locator('#postcode').isVisible().catch(() => false)) ||
      (await page.locator('#vehicle-detail').isVisible().catch(() => false));
  });

  await page.waitForTimeout(CONFIG.waitAfterClick);

  // ── Step 4: Check what happened ────────────────────────────────────
  const bodyText = await page.locator('body').innerText().catch(() => '');

  if (bodyText.includes('Unable to retrieve your vehicle information')) {
    console.log(`   ❌ No vehicle info — skipping`);
    page.off('dialog', dialogHandler);
    return emptyResult('NO_VEHICLE_INFO', 'Unable to retrieve your vehicle information');
  }

  // ── Step 5: Fill postcode if it appeared ────────────────────────────
  const postcodeVisible = await page.locator('#postcode').isVisible().catch(() => false);
  if (postcodeVisible) {
    console.log(`   Filling postcode: ${postcode}`);
    await page.locator('#postcode').fill(postcode);

    console.log('   Clicking SHOW RESULT (with postcode)...');
    await page.locator('#to-show-result').click();

    // Wait for vehicle detail or error (AJAX, no page nav)
    await waitForCondition(page, async () => {
      const text = await page.locator('body').innerText().catch(() => '');
      return !text.includes('Working...') ||
        text.includes('Unable to retrieve') ||
        (await page.locator('#vehicle-detail').isVisible().catch(() => false));
    });
    await page.waitForTimeout(CONFIG.waitAfterClick);
  }

  page.off('dialog', dialogHandler);

  // ── Step 6: Check for error again ──────────────────────────────────
  const bodyText2 = await page.locator('body').innerText().catch(() => '');
  if (bodyText2.includes('Unable to retrieve your vehicle information')) {
    console.log(`   ❌ No vehicle info — skipping`);
    return emptyResult('NO_VEHICLE_INFO', 'Unable to retrieve your vehicle information');
  }

  // ── Step 7: Check vehicle details appeared ─────────────────────────
  const detailVisible = await page.locator('#vehicle-detail').isVisible().catch(() => false);
  if (!detailVisible) {
    return emptyResult('ERROR', 'Vehicle detail did not appear');
  }

  // ── Step 8: Extract vehicle details ────────────────────────────────
  const vehicleInfo = await page.evaluate(() => {
    const get = (label: string): string => {
      const labels = document.querySelectorAll('#vehicle-detail td.quote-label');
      for (const el of labels) {
        if (el.textContent?.trim().replace(/\s+/g, ' ').includes(label)) {
          return el.nextElementSibling?.textContent?.trim().replace(/\s+/g, ' ') || '';
        }
      }
      return '';
    };
    return {
      make: get('Make'),
      model: get('Model'),
      manufacturingYear: get('Manufacturing Year'),
      engineCapacity: get('Engine Capacity'),
      transmission: get('Transmission'),
      variant: get('Variant'),
    };
  });

  console.log(`   ✅ ${vehicleInfo.make} ${vehicleInfo.model} (${vehicleInfo.manufacturingYear})`);

  // ── Step 9: Click GET QUOTE ────────────────────────────────────────
  // GET QUOTE button id is "to-continue"
  const getQuoteBtn = page.locator('#to-continue');
  if ((await getQuoteBtn.count()) === 0) {
    return emptyResult('ERROR', 'GET QUOTE button not found');
  }

  // Dialog handler from step 2 is still active — no need to add another one

  console.log('   Clicking GET QUOTE...');
  await getQuoteBtn.click();

  // Wait for quote results (AJAX)
  await waitForCondition(page, async () => {
    const text = await page.locator('body').innerText().catch(() => '');
    return !text.includes('Working...');
  });
  await page.waitForTimeout(CONFIG.waitAfterClick);

  // ── Step 10: Extract insurer data ──────────────────────────────────
  const insurers = await page.evaluate(() => {
    const clean = (s: string) => s.replace(/[\t\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();

    const results: {
      insurerName: string; coverType: string; allowToPurchase: string;
      referRiskCode: string; totalPrice: string;
    }[] = [];

    document.querySelectorAll('.plan-detail-table').forEach((table) => {
      const insurerName = clean(table.querySelector('.plan-name')?.textContent || 'Unknown');
      let coverType = '', allowToPurchase = '', referRiskCode = '', totalPrice = '';

      table.querySelectorAll('td').forEach((td) => {
        const text = clean(td.textContent || '');

        // Cover type: only get the first line (before "Period of insurance")
        if (text.startsWith('Cover Type') && !coverType) {
          const match = text.match(/^(Cover Type[^P]+)/);
          coverType = match ? clean(match[1]) : text.split('Period')[0].trim();
        }

        if (text.includes('Refer Risk')) {
          const cleaned = text.replace('Refer Risk:', '').replace('Refer Risk Code:', '').trim();
          if (cleaned && cleaned !== '-') referRiskCode = cleaned;
        }

        if (text.includes('Allow to purchase insurance:')) {
          allowToPurchase = clean(text.replace('Allow to purchase insurance:', ''));
        }
      });

      // Total price
      const rows = table.querySelectorAll('tr');
      for (const tr of rows) {
        if (tr.textContent?.includes('Total Price')) {
          const cells = tr.querySelectorAll('td');
          for (const td of cells) {
            const t = clean(td.textContent || '');
            if (t.match(/^RM\s[\d,.]+$/)) { totalPrice = t; break; }
          }
          if (!totalPrice) {
            const m = clean(tr.textContent || '').match(/RM\s[\d,.]+/);
            if (m) totalPrice = m[0];
          }
          break;
        }
      }

      results.push({ insurerName, coverType, allowToPurchase, referRiskCode: referRiskCode || '-', totalPrice: totalPrice || '-' });
    });
    return results;
  });

  console.log(`   📋 ${insurers.length} insurer(s):`);
  insurers.forEach(i => console.log(`     - ${i.insurerName}: Allow=${i.allowToPurchase}, Risk=${i.referRiskCode}, Price=${i.totalPrice}`));

  return { vehicleNumber: vn, ...vehicleInfo, insurers, status: 'SUCCESS' };
}

// ─── MAIN TEST ───────────────────────────────────────────────────────────────
test.describe('eAuto Insurance Quote Checker', () => {
  test.setTimeout(0);

  test('Check insurance quotes for all vehicles', async ({ page }) => {
    page.setDefaultNavigationTimeout(CONFIG.navigationTimeout);
    page.setDefaultTimeout(30000);

    // Read input
    const inputPath = path.resolve(CONFIG.inputFile);
    if (!fs.existsSync(inputPath)) {
      console.error(`❌ Input file not found: ${inputPath}`);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Vehicles');
      ws.columns = [
        { header: 'Vehicle Number', key: 'vn', width: 18 },
        { header: 'IC Number', key: 'ic', width: 18 },
        { header: 'Postcode', key: 'pc', width: 12 },
        { header: 'Vehicle Category', key: 'cat', width: 18 },
      ];
      ws.getRow(1).font = { bold: true };
      ws.addRow({ vn: 'JKC9998' });
      ws.addRow({ vn: 'AAAAAAA8' });
      await wb.xlsx.writeFile(inputPath);
      console.log(`✅ Sample created: ${inputPath} — add vehicles and run again.`);
      return;
    }

    const vehicles = await readInputExcel(inputPath);
    console.log(`📄 Loaded ${vehicles.length} vehicle(s)`);
    if (!vehicles.length) { console.log('⚠️ No vehicles.'); return; }

    // Login
    await login(page);

    // Process
    const results: VehicleResult[] = [];
    for (let i = 0; i < vehicles.length; i++) {
      console.log(`\n━━━ [${i + 1}/${vehicles.length}] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      try {
        results.push(await processVehicle(page, vehicles[i]));
      } catch (err) {
        console.error(`  ❌ Error: ${vehicles[i].vehicleNumber}:`, err);
        results.push({
          vehicleNumber: vehicles[i].vehicleNumber,
          make: '', model: '', manufacturingYear: '',
          engineCapacity: '', transmission: '', variant: '',
          insurers: [], status: 'ERROR', errorMessage: String(err),
        });
      }
    }

    // Output
    const outputPath = path.resolve(CONFIG.outputFile);
    await writeOutputExcel(results, outputPath);

    const ok = results.filter(r => r.status === 'SUCCESS').length;
    const skip = results.filter(r => r.status === 'NO_VEHICLE_INFO').length;
    const err = results.filter(r => r.status === 'ERROR').length;

    console.log('\n══════════════════════════════════════════════════════════');
    console.log(`📊 Total: ${results.length} | ✅ ${ok} success | ⏭️ ${skip} skipped | ❌ ${err} errors`);
    console.log(`📁 Output: ${outputPath}`);
    console.log('══════════════════════════════════════════════════════════\n');
  });
});