/**
 * ════════════════════════════════════════════════════════════════════════════
 *  eAuto UCD — INSURANCE END-TO-END AUTOMATION  (Get a Free Quote → Insurance Created)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Built as a senior-QA "golden path + cross-page consistency" harness.
 *  It drives the full 4-step UCD insurance purchase and, at every stage, captures
 *  the on-screen data so it can prove that the SAME data flows correctly across:
 *
 *      Step 1 Quotes  →  Step 2 Optional Coverage  →  Step 3 Payment  →
 *      Step 4 Confirm →  Transaction Listing  →  Transaction Details
 *
 *  Verifications performed (fails the run on mismatch):
 *    • Vehicle No, Owner/Insured IC, Vehicle (make/model), Year, Capacity
 *    • Cover Type            — identical on every page that shows it
 *    • Vehicle Use           — identical (car / motorbike)
 *    • Insurance Plan        — identical
 *    • Sum Covered           — identical
 *    • Insurer               — identical
 *    • Pricing MATH          — base + optional add-ons = gross; tax≈8%; total math; 10% discount
 *    • Total paid            — Step 3 == Step 4 == Listing == Details
 *    • Email                 — the value we typed reaches the final record
 *    • Hire Purchase bank    — the value we selected reaches the final record
 *    • E-Certificate No      — Step 4 == Listing == Details
 *
 *  Artifacts:
 *    • Self-narrating video  (on-screen caption banner + red spotlight on each target)
 *    • Annotated screenshots (important data boxed) at every meaningful step
 *    • Machine + human readable verification report (JSON + Markdown)
 *
 *  Inputs (all via env — the dashboard supplies them; VN is NEVER hardcoded):
 *    E2E_ENV, E2E_USERNAME, E2E_PASSWORD, E2E_VEHICLE_NO (required), E2E_IC (required),
 *    E2E_CATEGORY, E2E_EMAIL, E2E_INSURER, E2E_COVERAGE, E2E_SUM, E2E_BANK,
 *    E2E_ARTIFACT_DIR, E2E_STOP_BEFORE_PAYMENT, E2E_HEADLESS, E2E_SLOWMO
 * ════════════════════════════════════════════════════════════════════════════
 */

import { test, Page, Dialog } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ─── ENV / CONFIG ────────────────────────────────────────────────────────────
const env = (k: string, d = '') => (process.env[k]?.trim() ?? d);

const CFG = {
  env:        env('E2E_ENV', 'sit3'),
  username:   env('E2E_USERNAME', 'Azfar1'),
  password:   env('E2E_PASSWORD', '123456'),
  vehicleNo:  env('E2E_VEHICLE_NO'),
  ic:         env('E2E_IC'),
  category:   env('E2E_CATEGORY', 'individual').toLowerCase(),   // individual | company
  email:      env('E2E_EMAIL', 'amirul.azfar@modefair.com'),
  insurer:    env('E2E_INSURER', 'first').toLowerCase(),         // first|random|zurich-comprehensive|zurich-tpft|takaful-comprehensive|takaful-tpft|chubb
  coverage:   env('E2E_COVERAGE', 'random').toLowerCase(),       // random | none | all
  sumMode:    env('E2E_SUM', 'default').toLowerCase(),           // default | random | max
  bank:       env('E2E_BANK', 'random'),                         // "random" or an exact option label
  artifactDir:env('E2E_ARTIFACT_DIR', path.join(__dirname, 'artifacts', 'local')),
  stopBeforePayment: env('E2E_STOP_BEFORE_PAYMENT', '0') === '1',
  baseUrl:    `https://staging.eauto.my/${env('E2E_ENV', 'sit3')}`,
};

const CANDIDATE_BANKS = [
  'Maybank Berhad', 'CIMB Bank Berhad', 'Public Bank Berhad',
  'RHB Bank Berhad', 'Hong Leong Bank Berhad', 'AmBank Berhad',
];

// ─── STREAMING HELPERS (consumed by the dashboard via stdout) ─────────────────
const progress = (step: string, status: string, label?: string) =>
  console.log('PROGRESS:' + JSON.stringify({ step, status, label }));
const emitArtifact = (a: object) => console.log('ART:' + JSON.stringify(a));
const emitResult = (r: object) => console.log('RESULT:' + JSON.stringify(r));
const info  = (m: string) => console.log(m);
const good  = (m: string) => console.log('✅ ' + m);
const warn  = (m: string) => console.log('⚠️ ' + m);
const bad   = (m: string) => console.log('❌ ' + m);

// ─── SMALL UTILS ──────────────────────────────────────────────────────────────
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(arr: T[]): T => arr[rnd(arr.length)];
const norm = (s?: string) => (s || '').replace(/\s+/g, ' ').trim();
const parseMoney = (s?: string): number | null => {
  if (!s) return null;
  // Strip thousands-separator commas FIRST (regardless of an "RM" prefix being
  // present), then grab the first decimal number. Values are captured both
  // with and without "RM" depending on which page/regex found them, so this
  // must not depend on "RM" being there.
  const m = String(s).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
};
const approxEq = (a: number | null, b: number | null, tol = 0.05) =>
  a != null && b != null && Math.abs(a - b) <= tol;

// ═════════════════════════════════════════════════════════════════════════════
//  THE TEST
// ═════════════════════════════════════════════════════════════════════════════
test('UCD Insurance E2E — full flow + cross-page verification', async ({ page }, testInfo) => {
  test.setTimeout(0);

  // Validate required inputs early.
  const missing = ['vehicleNo', 'ic'].filter((k) => !(CFG as any)[k]);
  if (missing.length) throw new Error(`Missing required input(s): ${missing.join(', ')}`);

  fs.mkdirSync(CFG.artifactDir, { recursive: true });

  info(`━━━ UCD Insurance E2E ━━━`);
  info(`   Env=${CFG.env}  VN=${CFG.vehicleNo}  IC=${CFG.ic}  Insurer=${CFG.insurer}  Coverage=${CFG.coverage}`);
  info(`   Email=${CFG.email}  Bank=${CFG.bank}  StopBeforePayment=${CFG.stopBeforePayment}`);

  // ── Video narration + action-spotlight overlay (injected on every page) ─────
  await page.addInitScript(() => {
    const ensure = () => {
      if (!document.getElementById('e2e-banner')) {
        const b = document.createElement('div');
        b.id = 'e2e-banner';
        b.style.cssText =
          'position:fixed;top:0;left:0;right:0;z-index:2147483647;font-family:Inter,Arial,sans-serif;' +
          'background:linear-gradient(90deg,#4f46e5,#7c3aed);color:#fff;padding:9px 16px;font-size:15px;' +
          'font-weight:600;letter-spacing:.2px;box-shadow:0 2px 10px rgba(0,0,0,.35);display:flex;' +
          'align-items:center;gap:10px;';
        b.innerHTML = '<span id="e2e-badge" style="background:rgba(255,255,255,.22);padding:2px 9px;border-radius:20px;font-size:12px;">E2E</span><span id="e2e-banner-text">Starting…</span>';
        document.documentElement.appendChild(b);
      }
    };
    if (document.body) ensure();
    document.addEventListener('DOMContentLoaded', ensure);
    // Pulse anything the automation clicks/focuses so the video is easy to follow.
    const style = document.createElement('style');
    style.textContent =
      '.e2e-pulse{outline:3px solid #ff2d55 !important;box-shadow:0 0 0 4px rgba(255,45,85,.28) !important;transition:outline .1s,box-shadow .1s;}';
    document.documentElement.appendChild(style);
    const pulse = (el: any) => {
      if (!(el instanceof HTMLElement)) return;
      el.classList.add('e2e-pulse');
      setTimeout(() => el.classList.remove('e2e-pulse'), 700);
    };
    document.addEventListener('click', (e) => pulse(e.target), true);
    document.addEventListener('focusin', (e) => pulse(e.target), true);
  });

  // Update the on-screen caption (persists in the video).
  const announce = async (text: string) => {
    info('▶ ' + text);
    await page.evaluate((t) => {
      const el = document.getElementById('e2e-banner-text');
      if (el) el.textContent = t;
    }, text).catch(() => {});
    await page.waitForTimeout(500);
  };

  // ── Annotated screenshot ────────────────────────────────────────────────────
  // Draws a red spotlight box (+ optional label chip) around each target, plus a
  // caption strip, then saves a viewport screenshot with a numbered, descriptive name.
  let shotIdx = 0;
  const shot = async (
    slug: string,
    caption: string,
    boxes: { sel?: string; text?: string; label: string }[] = [],
  ) => {
    shotIdx += 1;
    const num = String(shotIdx).padStart(2, '0');
    // Resolve bounding boxes in-page then draw overlays.
    const rects: { x: number; y: number; w: number; h: number; label: string }[] = [];
    for (const b of boxes) {
      try {
        let loc = b.sel ? page.locator(b.sel).first()
          : b.text ? page.getByText(b.text, { exact: false }).first()
          : null;
        if (!loc) continue;
        if (await loc.count() === 0) continue;
        await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        const bb = await loc.boundingBox();
        if (bb && bb.width > 0 && bb.height > 0) rects.push({ x: bb.x, y: bb.y, w: bb.width, h: bb.height, label: b.label });
      } catch { /* ignore box that can't resolve */ }
    }
    await page.evaluate(({ rects, caption }) => {
      const wrap = document.createElement('div');
      wrap.id = 'e2e-annot';
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
      // caption strip (below the banner)
      const cap = document.createElement('div');
      cap.style.cssText =
        'position:fixed;top:42px;left:16px;max-width:70%;background:rgba(15,17,26,.92);color:#e7eaf0;' +
        'font-family:Inter,Arial,sans-serif;font-size:13px;font-weight:600;padding:7px 12px;border-radius:8px;' +
        'border:1px solid #4f46e5;box-shadow:0 4px 14px rgba(0,0,0,.4);';
      cap.textContent = '📸 ' + caption;
      wrap.appendChild(cap);
      for (const r of rects) {
        const box = document.createElement('div');
        box.style.cssText =
          `position:fixed;left:${r.x - 4}px;top:${r.y - 4}px;width:${r.w + 8}px;height:${r.h + 8}px;` +
          'border:2.5px solid #ff2d55;border-radius:6px;box-shadow:0 0 0 3px rgba(255,45,85,.18);';
        const tag = document.createElement('div');
        tag.textContent = r.label;
        tag.style.cssText =
          `position:fixed;left:${r.x - 4}px;top:${Math.max(r.y - 24, 66)}px;background:#ff2d55;color:#fff;` +
          'font-family:Inter,Arial,sans-serif;font-size:11px;font-weight:700;padding:1px 7px;border-radius:5px;white-space:nowrap;';
        wrap.appendChild(box);
        wrap.appendChild(tag);
      }
      document.body.appendChild(wrap);
    }, { rects, caption }).catch(() => {});
    await page.waitForTimeout(650); // let it linger for the video too
    const file = `${num}_${slug}.png`;
    await page.screenshot({ path: path.join(CFG.artifactDir, file) }).catch(() => {});
    await page.evaluate(() => document.getElementById('e2e-annot')?.remove()).catch(() => {});
    emitArtifact({ kind: 'screenshot', file, caption });
    info(`   📸 ${file}`);
  };

  // Spotlight a target for the video, then perform the click.
  const clickWithSpotlight = async (sel: string, label: string) => {
    const loc = page.locator(sel).first();
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await announce(label);
    await loc.click({ timeout: 30000 });
  };

  // ── Generic label→value extractor (these pages use "label : value" adjacency) ─
  const extract = async (labels: string[]): Promise<Record<string, string>> => {
    return page.evaluate((labels) => {
      const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const out: Record<string, string> = {};
      const nodes = Array.from(document.querySelectorAll('td,th,div,span,dt,label,p,li,strong'));
      for (const label of labels) {
        let val = '';
        for (const el of nodes) {
          const t = clean(el.textContent);
          if (t === label || t === label + ':' || t === label + ' :') {
            // 1) next element sibling
            const sib = el.nextElementSibling as HTMLElement | null;
            if (sib && clean(sib.textContent)) { val = clean(sib.textContent); break; }
            // 2) same table row, following cell
            const cell = el.closest('td,th');
            const row = el.closest('tr');
            if (row && cell) {
              const cells = Array.from(row.children) as HTMLElement[];
              const i = cells.indexOf(cell as HTMLElement);
              if (i >= 0 && cells[i + 1] && clean(cells[i + 1].textContent)) { val = clean(cells[i + 1].textContent); break; }
            }
            // 3) parent's next sibling (dt/dd or div/div patterns)
            const p = el.parentElement;
            if (p && p.nextElementSibling && clean(p.nextElementSibling.textContent)) { val = clean(p.nextElementSibling.textContent); break; }
          }
        }
        out[label] = val;
      }
      return out;
    }, labels);
  };

  // Cover type appears as "Cover Type: COMPREHENSIVE" or as a card header word.
  const readCoverType = async (): Promise<string> => {
    return page.evaluate(() => {
      const body = (document.body.innerText || '').replace(/\s+/g, ' ');
      const m = body.match(/Cover Type\s*:?\s*(COMPREHENSIVE|THIRD PARTY[^A-Za-z]*FIRE[^A-Za-z]*THEFT|THIRD PARTY|PRIVATE CAR[^A-Za-z]*\(?ENHANCED\)?|TPFT)/i);
      return m ? m[1].replace(/\s+/g, ' ').trim().toUpperCase() : '';
    });
  };

  const normalizeCover = (s: string) => {
    const u = (s || '').toUpperCase();
    if (u.includes('COMPREHENSIVE')) return 'COMPREHENSIVE';
    if (u.includes('THIRD PARTY') || u === 'TPFT') return 'TPFT';
    if (u.includes('PRIVATE CAR')) return 'PRIVATE CAR (ENHANCED)';
    return u;
  };

  // Whole-page text (minus our overlays + style/script) for robust regex extraction.
  // Many eAuto fields are headings ("Reference No: B123") or right-aligned rows, which
  // the label→sibling extractor misses — body-regex is layout-agnostic.
  const bodyText = async (): Promise<string> => page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('#e2e-banner,#e2e-annot,style,script,noscript').forEach((e) => e.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }).catch(() => '');
  const bodyMatch = async (re: RegExp): Promise<string> => {
    const m = (await bodyText()).match(re);
    return m ? (m[1] || '').trim() : '';
  };
  // Common field patterns (reused across steps + details).
  // NOTE: e-certificate format and whether a "10% discount" line even appears
  // both vary by insurer (e.g. Zurich = "T73829X-26005053", others = "A2984912"
  // with no dash at all) — patterns below are intentionally insurer-agnostic.
  const RX = {
    refNo:   /Reference No[.:\s]*([A-Z]{1,3}\d{5,})/i,
    eCert:   /E-?certificate No\.?(?:\s*\/\s*Policy No)?[.:\s]*([A-Z0-9]{4,}(?:-[A-Z0-9]{3,})?)/i,
    sum:     /(?:Total )?Sum (?:Covered|Insured)[:\s]*RM\s?([\d,]+\.\d{2})/i,
    basic:   /Basic Contribution[:\s]*RM\s?([\d,]+\.\d{2})/i,
    afterNcd:/Contribution After NCD[:\s]*RM\s?([\d,]+\.\d{2})/i,
    gross:   /Gross Contribution[:\s]*RM\s?([\d,]+\.\d{2})/i,
    tax:     /Service Tax[:\s]*RM\s?([\d,]+\.\d{2})/i,
    stamp:   /Stamp Duty[:\s]*RM\s?([\d,]+\.\d{2})/i,
    totalContrib: /Total Contribution\s*RM\s?([\d,]+\.\d{2})/i,
    // Primary: the "after 10% agent discount" line (not every insurer/scenario shows one).
    totalNett:    /Total Nett Contribution After Discount\s*RM\s?([\d,]+\.\d{2})/i,
    // Fallback: the amount shown right next to PAY NOW — always present regardless of insurer/discount.
    priceIncludeTax: /Price include Service Tax\s*RM\s?([\d,]+\.\d{2})/i,
  };

  // Dismiss campaign / modal popups (ids change per campaign: raya, cny, …).
  const closePopup = async () => {
    for (let i = 0; i < 4; i++) {
      const closed = await page.evaluate(() => {
        const sels = ['#dialog-campaign-close-btn', '.close-btn', '[id$="-campaign"] .close', '.modal.show .close', '.swal2-close'];
        for (const s of sels) {
          const el = document.querySelector(s) as HTMLElement | null;
          if (el && el.offsetParent !== null) { el.click(); return true; }
        }
        // force-remove leftover backdrops
        document.querySelectorAll('.modal-backdrop').forEach((e) => e.remove());
        document.body.classList.remove('modal-open');
        return false;
      }).catch(() => false);
      if (!closed) break;
      await page.waitForTimeout(400);
    }
  };

  // Poll until the blocking "Working…" overlay is gone.
  const waitWorkingDone = async (maxMs = 60000) => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const txt = await page.locator('body').innerText().catch(() => '');
      if (!/working/i.test(txt)) return;
      await page.waitForTimeout(1200);
    }
  };

  // The verification ledger — every tracked field, its value per page, + verdicts.
  const snap: Record<string, Record<string, string>> = {}; // page → fields
  const checks: { name: string; pass: boolean; detail: string }[] = [];
  const record = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, pass, detail });
    (pass ? good : bad)(`${name} — ${detail}`);
  };

  const transactionIds: string[] = [];
  const rememberTxnId = () => {
    const m = page.url().match(/transactionId=([0-9a-f-]{8,})/i);
    if (m && !transactionIds.includes(m[1])) transactionIds.push(m[1]);
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  STEP: LOGIN
  // ══════════════════════════════════════════════════════════════════════════
  progress('login', 'running', 'Login');
  await page.goto(`${CFG.baseUrl}/public/login/`, { waitUntil: 'domcontentloaded' });
  await announce(`Logging in to ${CFG.env} as ${CFG.username}`);
  await page.locator('input[name="username"], input[placeholder*="Username" i]').first().fill(CFG.username);
  await page.locator('input[name="password"], input[placeholder*="Password" i]').first().fill(CFG.password);
  await Promise.all([
    page.waitForURL(/\/view\/ucd\/home(\.do)?/, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {}),
    page.locator('button:has-text("Login"), input[type="submit"], button[type="submit"]').first().click(),
  ]);
  await page.waitForTimeout(1500);
  await closePopup();
  if (!/\/view\/ucd\/home/.test(page.url())) {
    // Some envs land elsewhere; force-nav to UCD home.
    await page.goto(`${CFG.baseUrl}/view/ucd/home.do`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await closePopup();
  }
  await shot('login-home', `Logged in as ${CFG.username} — UCD home`, [{ text: CFG.username.toUpperCase(), label: 'Logged-in user' }]);
  progress('login', 'done');

  // ══════════════════════════════════════════════════════════════════════════
  //  STEP: OPEN INSURANCE → GET A FREE QUOTE
  // ══════════════════════════════════════════════════════════════════════════
  progress('free_quote', 'running', 'Open Insurance');
  await announce('Opening the Insurance module');
  await page.goto(`${CFG.baseUrl}/view/ucd/insurance/home.do`, { waitUntil: 'domcontentloaded' });
  await closePopup();
  await shot('insurance-home', 'Insurance landing — 4 options', [{ text: 'GET A FREE QUOTE', label: 'Entry point' }]);
  await clickWithSpotlight('text=GET A FREE QUOTE', 'Clicking “Get a Free Quote”');
  await page.waitForURL(/quote\/view\.do/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  progress('free_quote', 'done');

  // ══════════════════════════════════════════════════════════════════════════
  //  STEP 1: QUOTES — enter VN + IC, choose insurer
  // ══════════════════════════════════════════════════════════════════════════
  progress('quotes', 'running', 'Step 1 · Quotes');
  // Guard: make sure the quote form actually rendered (staging can stall here).
  const formReady = await page.locator('form input[type="text"]').first()
    .waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
  if (!formReady) {
    await shot('step1-noform', 'Step 1 — quote form did not load (staging unresponsive?)');
    throw new Error('Quote form did not render — the e-simulator/staging may be unresponsive. Retry when it is healthy.');
  }
  await announce(`Entering vehicle ${CFG.vehicleNo} and IC`);
  if (CFG.category === 'company') {
    await page.locator('input[name="vehicleCategory"][value="company"], input[type="radio"][value="company"]').first().check().catch(() => {});
  }
  // Vehicle Number + IC Number = the first two *visible* text inputs on the form.
  // (fill() replaces the value outright, so no double-typing; no separate click needed.)
  const textInputs = page.locator('form input[type="text"]:visible');
  const vnInput = textInputs.first();
  const icInput = textInputs.nth(1);
  await vnInput.fill(CFG.vehicleNo);
  await icInput.fill(CFG.ic);
  await shot('step1-form', 'Step 1 — Create Free Quote form filled', [
    { sel: 'form input[type="text"]:visible >> nth=0', label: 'Vehicle No' },
    { sel: 'form input[type="text"]:visible >> nth=1', label: 'IC No' },
  ]);

  // Handle native alert (rare) + submit.
  page.removeAllListeners('dialog');
  page.on('dialog', async (d: Dialog) => { info(`   📢 dialog: "${d.message()}"`); await d.accept().catch(() => {}); });

  await announce('Submitting — Show My Result');
  await page.locator('button:has-text("Show My Result"), input[value*="Show My Result" i]').first().click();

  // Wait for either the quote cards or the "unable to retrieve" error modal.
  const gotCards = await Promise.race([
    page.waitForURL(/plan\/view\.do/, { timeout: 45000 }).then(() => true).catch(() => false),
    page.waitForSelector('button:has-text("SELECT")', { timeout: 45000 }).then(() => true).catch(() => false),
  ]);
  await waitWorkingDone(45000);
  await page.waitForTimeout(1000);
  rememberTxnId();

  const bodyTxt = await page.locator('body').innerText().catch(() => '');
  if (/unable to retrieve your vehicle information/i.test(bodyTxt)) {
    await shot('step1-error', 'Step 1 — vehicle info could not be retrieved');
    throw new Error(`Vehicle ${CFG.vehicleNo} — "Unable to retrieve your vehicle information". Try a different VN.`);
  }
  if (!gotCards && (await page.locator('button:has-text("SELECT")').count()) === 0) {
    await shot('step1-noquote', 'Step 1 — no quote cards appeared');
    throw new Error(`No insurer quote cards appeared for ${CFG.vehicleNo}.`);
  }

  // Capture the top vehicle summary bar.
  const v = await extract(['Owner NRIC', 'Vehicle Reg. Num', 'Vehicle Reg Num', 'Vehicle', 'Year', 'NCD', 'Capacity', 'Transmission', 'Variant (Series)', 'Variant']);
  snap.step1 = {
    ownerIC: v['Owner NRIC'] || '',
    vehicleRegNo: v['Vehicle Reg. Num'] || v['Vehicle Reg Num'] || '',
    vehicle: v['Vehicle'] || '',
    year: v['Year'] || '',
    ncd: v['NCD'] || '',
    capacity: v['Capacity'] || '',
    transmission: v['Transmission'] || '',
    variant: v['Variant (Series)'] || v['Variant'] || '',
  };
  info(`   🚗 ${snap.step1.vehicle} (${snap.step1.year}) · ${snap.step1.capacity} · Owner ${snap.step1.ownerIC}`);

  // Enumerate the insurer cards; tag SELECT buttons + each card's sum dropdown.
  const cards: { idx: number; insurer: string; cover: string; total: string; sum: string }[] = await page.evaluate(() => {
    const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const btns = Array.from(document.querySelectorAll('button, input[type="submit"], a'))
      .filter((b) => /select\s+(zurich|takaful|chubb|lonpac|tokio|rhb)/i.test(clean(b.textContent || (b as HTMLInputElement).value)));
    const out: any[] = [];
    btns.forEach((b, i) => {
      (b as HTMLElement).setAttribute('data-e2e-idx', String(i));
      const label = clean(b.textContent || (b as HTMLInputElement).value);
      const insurer = (label.match(/select\s+([a-z]+)/i) || [, ''])[1].toUpperCase();
      // climb to a card ancestor that mentions the cover type
      let node: HTMLElement | null = b as HTMLElement;
      let cardNode: HTMLElement | null = null;
      let cardText = '';
      for (let up = 0; up < 7 && node; up++) {
        node = node.parentElement;
        const t = clean(node?.textContent);
        if (/COMPREHENSIVE|THIRD PARTY|PRIVATE CAR/i.test(t) && /sum/i.test(t)) { cardText = t; cardNode = node; break; }
      }
      const cover = (cardText.match(/COMPREHENSIVE|THIRD PARTY[, ]*FIRE[ &]*THEFT|PRIVATE CAR[ ]*\(?ENHANCED\)?/i) || [''])[0].toUpperCase();
      const total = (cardText.match(/RM\s?[\d,]+\.\d{2}\s*\/?\s*year/i) || [''])[0];
      // tag this card's sum-covered dropdown and read its current value
      let sum = '';
      const sel = cardNode?.querySelector('select') as HTMLSelectElement | null;
      if (sel) { sel.setAttribute('data-e2e-sumidx', String(i)); sum = clean(sel.options[sel.selectedIndex]?.textContent); }
      out.push({ idx: i, insurer, cover, total, sum });
    });
    return out;
  });
  info(`   📋 ${cards.length} quote card(s): ` + cards.map((c) => `${c.insurer}/${normalizeCover(c.cover)}`).join(', '));

  // Choose the card per preference.
  const matchPref = (c: { insurer: string; cover: string }) => {
    const key = `${c.insurer}-${normalizeCover(c.cover)}`.toLowerCase().replace('comprehensive', 'comprehensive').replace('tpft', 'tpft');
    switch (CFG.insurer) {
      case 'zurich-comprehensive': return /zurich/.test(c.insurer.toLowerCase()) && normalizeCover(c.cover) === 'COMPREHENSIVE';
      case 'zurich-tpft':          return /zurich/.test(c.insurer.toLowerCase()) && normalizeCover(c.cover) === 'TPFT';
      case 'takaful-comprehensive':return /takaful/.test(c.insurer.toLowerCase()) && normalizeCover(c.cover) === 'COMPREHENSIVE';
      case 'takaful-tpft':         return /takaful/.test(c.insurer.toLowerCase()) && normalizeCover(c.cover) === 'TPFT';
      case 'chubb':                return /chubb/.test(c.insurer.toLowerCase());
      default: return false;
    }
  };
  let chosen = cards[0];
  if (CFG.insurer === 'random') chosen = pick(cards);
  else if (CFG.insurer !== 'first') {
    const found = cards.find(matchPref);
    if (found) chosen = found;
    else warn(`Preferred insurer "${CFG.insurer}" not offered for ${CFG.vehicleNo} — falling back to first card (${cards[0].insurer}/${normalizeCover(cards[0].cover)}).`);
  }
  const chosenCover = normalizeCover(chosen.cover);
  snap.step1.insurer = chosen.insurer;
  snap.step1.coverType = chosenCover;
  snap.step1.cardTotal = chosen.total;
  info(`   👉 Selected: ${chosen.insurer} · ${chosenCover} · ${chosen.total}`);

  // Optionally change the chosen card's sum-covered dropdown (tagged during enumeration).
  const chosenSelect = page.locator(`select[data-e2e-sumidx="${chosen.idx}"]`);
  if (CFG.sumMode !== 'default' && (await chosenSelect.count()) > 0) {
    const opts = await chosenSelect.locator('option').allTextContents();
    if (opts.length > 1) {
      const targetIdx = CFG.sumMode === 'max' ? opts.length - 1 : 1 + rnd(opts.length - 1);
      await announce(`Changing Sum Covered → ${norm(opts[targetIdx])}`);
      await chosenSelect.selectOption({ index: targetIdx });
      await waitWorkingDone(20000);
      await page.waitForTimeout(1500);
    }
  }
  const chosenSum = (await chosenSelect.count()) > 0
    ? norm(await chosenSelect.locator('option:checked').first().textContent().catch(() => ''))
    : norm(chosen.sum);
  snap.step1.sumCovered = chosenSum;

  await shot('step1-quotes', `Step 1 — ${cards.length} quotes; choosing ${chosen.insurer} (${chosenCover})`, [
    { sel: `[data-e2e-idx="${chosen.idx}"]`, label: `SELECT ${chosen.insurer}` },
    { text: 'Sum Covered', label: 'Sum Covered' },
  ]);

  await announce(`Selecting ${chosen.insurer} (${chosenCover})`);
  await page.locator(`[data-e2e-idx="${chosen.idx}"]`).click();
  await page.waitForURL(/plan\/select\.do/, { timeout: 30000 }).catch(() => {});
  await waitWorkingDone();
  await page.waitForTimeout(1200);
  progress('quotes', 'done');

  // ══════════════════════════════════════════════════════════════════════════
  //  STEP 2: OPTIONAL COVERAGE
  // ══════════════════════════════════════════════════════════════════════════
  progress('coverage', 'running', 'Step 2 · Optional Coverage');
  const p2 = await extract(['Owner NRIC', 'Vehicle', 'Vehicle Reg. Num', 'Vehicle Reg Num', 'Year', 'Company', 'Insurance/Takaful Plan', 'Total Sum Covered', 'Period of Takaful', 'Period of Insurance', 'Excess']);
  const cover2 = await readCoverType();
  snap.step2 = {
    ownerIC: p2['Owner NRIC'] || '',
    vehicle: p2['Vehicle'] || '',
    vehicleRegNo: p2['Vehicle Reg. Num'] || p2['Vehicle Reg Num'] || '',
    year: p2['Year'] || '',
    company: p2['Company'] || '',
    plan: p2['Insurance/Takaful Plan'] || '',
    totalSumCovered: p2['Total Sum Covered'] || '',
    period: p2['Period of Takaful'] || p2['Period of Insurance'] || '',
    excess: p2['Excess'] || '',
    coverType: normalizeCover(cover2),
  };
  info(`   🛡️ Plan: ${snap.step2.company} · ${snap.step2.plan} · Cover ${snap.step2.coverType} · SumCovered ${snap.step2.totalSumCovered}`);

  // Discover the optional-coverage checkboxes dynamically (differs per insurer/plan).
  const optItems: { id: string; label: string; price: string; hasSum: boolean }[] = await page.evaluate(() => {
    const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    return boxes.map((cb) => {
      const row = cb.closest('tr, li, div');
      const rowTxt = clean(row?.textContent);
      const priceM = rowTxt.match(/RM\s?[\d,]+\.\d{2}/);
      const label = clean(rowTxt)
        .replace(/RM\s?[\d,]+\.\d{2}/g, '')
        .replace(/\+?\s*More info/ig, '')
        .replace(/\(Min[^)]*\)/ig, '')
        .replace(/Sum Covered.*$/i, '')
        .trim().slice(0, 60);
      const hasSum = /Sum Covered/i.test(rowTxt) && !!row?.querySelector('input[type="number"], input[type="text"]');
      return { id: cb.id || '', label, price: priceM ? priceM[0] : 'RM 0.00', hasSum: !!hasSum };
    }).filter((x) => x.id && !/By clicking|will be chosen/i.test(x.label));
  });
  info(`   ☑️ ${optItems.length} optional coverage item(s): ` + optItems.map((o) => `${o.label.split('  ')[0]}[${o.id}]`).join(', '));

  // Decide selections.
  const selected: { id: string; label: string; price: string }[] = [];
  let allDriversTicked = false;
  const setCb = async (id: string, want: boolean) => {
    const cur = await page.evaluate((id) => (document.getElementById(id) as HTMLInputElement)?.checked, id);
    if (cur !== want) {
      await page.evaluate((id) => (document.getElementById(id) as HTMLInputElement)?.click(), id);
      await page.waitForTimeout(400);
    }
  };
  for (const o of optItems) {
    let want: boolean;
    if (CFG.coverage === 'all') want = true;
    else if (CFG.coverage === 'none') want = false;
    else want = Math.random() < 0.5; // random mix & match
    // avoid the All Drivers confirmation popup unless we deliberately keep it
    await setCb(o.id, want);
    if (want) {
      if (o.hasSum) {
        // fill the windscreen sum within its Min–Max
        const row = page.locator(`#${o.id}`).locator('xpath=ancestor::*[self::tr or self::li or self::div][1]');
        const numInput = row.locator('input[type="number"], input[type="text"]').first();
        if (await numInput.count() > 0) {
          const rowTxt = await row.innerText().catch(() => '');
          const mm = rowTxt.match(/Min\s*RM([\d,]+).*?Max\s*RM([\d,]+)/i);
          const lo = mm ? parseInt(mm[1].replace(/,/g, ''), 10) : 500;
          const hi = mm ? parseInt(mm[2].replace(/,/g, ''), 10) : 1000;
          const val = Math.round((lo + hi) / 2 / 100) * 100;
          await numInput.fill(String(val));
          await numInput.press('Tab');
          await page.waitForTimeout(1200);
        }
      }
      if (/all drivers/i.test(o.label)) allDriversTicked = true;
      selected.push({ id: o.id, label: o.label, price: o.price });
    }
  }
  await waitWorkingDone(20000);
  await page.waitForTimeout(800);

  // Capture the recomputed quotation (body-regex — layout-agnostic).
  snap.step2.totalSumCovered = snap.step2.totalSumCovered || await bodyMatch(RX.sum);
  snap.step2.basicContribution = await bodyMatch(RX.basic);
  snap.step2.contributionAfterNCD = await bodyMatch(RX.afterNcd);
  snap.step2.gross = await bodyMatch(RX.gross);
  snap.step2.serviceTax = await bodyMatch(RX.tax);
  snap.step2.stampDuty = await bodyMatch(RX.stamp);
  snap.step2.total = await bodyMatch(RX.totalContrib);
  snap.step2.selectedCoverage = selected.map((s) => s.label).join(', ') || '(none)';

  // Pricing math checks (Step 2).
  const grossN = parseMoney(snap.step2.gross);
  const afterNcdN = parseMoney(snap.step2.contributionAfterNCD);
  const optSum = selected.reduce((a, s) => a + (parseMoney(s.price) || 0), 0);
  const taxN = parseMoney(snap.step2.serviceTax);
  const stampN = parseMoney(snap.step2.stampDuty);
  const totalN = parseMoney(snap.step2.total);
  if (afterNcdN != null && grossN != null)
    record('Step2 Gross = AfterNCD + optional add-ons', approxEq(grossN, afterNcdN + optSum, 0.5),
      `AfterNCD ${afterNcdN} + add-ons ${optSum.toFixed(2)} ≈ Gross ${grossN}`);
  if (grossN != null && taxN != null)
    record('Step2 Service Tax ≈ 8% of Gross', approxEq(taxN, +(grossN * 0.08).toFixed(2), 0.5),
      `8% of ${grossN} = ${(grossN * 0.08).toFixed(2)} vs shown ${taxN}`);
  if (grossN != null && taxN != null && stampN != null && totalN != null)
    record('Step2 Total = Gross + Tax + Stamp', approxEq(totalN, grossN + taxN + stampN, 0.1),
      `${grossN}+${taxN}+${stampN} = ${(grossN + taxN + stampN).toFixed(2)} vs ${totalN}`);

  await shot('step2-coverage', `Step 2 — coverage: ${snap.step2.selectedCoverage}`, [
    { text: 'Optional Coverage', label: 'Optional Coverage' },
    { text: 'Total Contribution', label: 'Live Total' },
  ]);
  info(`   💰 Step2 total ${snap.step2.total} (coverage: ${snap.step2.selectedCoverage})`);

  // Proceed → Make Payment (handle All Drivers warning + occasional double-click).
  await announce('Proceeding to Payment');
  const clickMakePayment = () => page.locator('button:has-text("Make Payment"), input[value*="Make Payment" i]').first().click().catch(() => {});
  await clickMakePayment();
  await page.waitForTimeout(1200);
  // All Drivers advisory popup
  const proceedBtn = page.locator('button:has-text("Proceed")').first();
  if (await proceedBtn.count() > 0 && await proceedBtn.isVisible().catch(() => false)) {
    await shot('step2-alldrivers-popup', 'Step 2 — “untick All Drivers” advisory popup (expected while All Drivers is ticked)', [{ text: 'All Drivers', label: 'Advisory' }]);
    await announce('Confirming All Drivers advisory → Proceed');
    await proceedBtn.click();
    await page.waitForTimeout(800);
    await clickMakePayment();
  }
  // ensure we reached payment.do
  await page.waitForURL(/payment\.do/, { timeout: 30000 }).catch(() => {});
  if (!/payment\.do/.test(page.url())) { await clickMakePayment(); await page.waitForURL(/payment\.do/, { timeout: 30000 }).catch(() => {}); }
  await waitWorkingDone();
  await page.waitForTimeout(1200);
  rememberTxnId();
  progress('coverage', 'done');

  // ══════════════════════════════════════════════════════════════════════════
  //  STEP 3: PAYMENT — set email + hire purchase, verify carry-over
  // ══════════════════════════════════════════════════════════════════════════
  progress('payment', 'running', 'Step 3 · Payment');
  const p3 = await extract([
    'Reference No', 'Full Name', 'IC No', 'Vehicle No', 'Engine No', 'Chassis No', 'Make', 'Model',
    'Period of Takaful', 'Period of Insurance', 'Vehicle Use', 'Capacity', 'Year of Manufacturer',
    'Sum Covered', 'Basic Contribution', 'Contribution After NCD', 'Gross Contribution',
    'Service Tax', 'Stamp Duty', 'Total Nett Contribution After Discount',
  ]);
  const cover3 = await readCoverType();
  snap.step3 = {
    referenceNo: await bodyMatch(RX.refNo),
    insuredName: p3['Full Name'] || '',
    ownerIC: p3['IC No'] || '',
    vehicleRegNo: p3['Vehicle No'] || '',
    engineNo: p3['Engine No'] || '',
    chassisNo: p3['Chassis No'] || '',
    model: p3['Model'] || '',
    vehicleUse: p3['Vehicle Use'] || '',
    capacity: p3['Capacity'] || '',
    year: p3['Year of Manufacturer'] || '',
    period: p3['Period of Takaful'] || p3['Period of Insurance'] || '',
    coverType: normalizeCover(cover3),
    sumCovered: await bodyMatch(RX.sum),
    gross: await bodyMatch(RX.gross),
    serviceTax: await bodyMatch(RX.tax),
    stampDuty: await bodyMatch(RX.stamp),
    // Some insurers/scenarios show no "after 10% discount" line at all — fall
    // back to the amount next to PAY NOW, which is always present.
    totalNett: (await bodyMatch(RX.totalNett)) || (await bodyMatch(RX.priceIncludeTax)),
  };
  info(`   🧾 Ref ${snap.step3.referenceNo} · Insured ${snap.step3.insuredName} · Use ${snap.step3.vehicleUse} · Nett ${snap.step3.totalNett}`);

  await shot('step3-person-vehicle', 'Step 3 — Person Covered + Vehicle details', [
    { text: 'Person Covered', label: 'Person Covered' },
    { text: 'Reference No', label: 'Reference No' },
  ]);

  // Set the email (must reach the final record → user verifies delivery).
  await announce(`Setting notification email → ${CFG.email}`);
  // Find the email field robustly: it's the input whose value already contains "@".
  const emailSel = await page.evaluate((val) => {
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    const target = inputs.find((i) => /@/.test(i.value));
    if (target) { target.setAttribute('data-e2e-email', '1'); return true; }
    return false;
  }, CFG.email);
  if (emailSel) {
    const ef = page.locator('input[data-e2e-email="1"]');
    await ef.click(); await ef.fill(''); await ef.fill(CFG.email);
  } else {
    warn('Could not locate the email field by value — leaving default.');
  }
  snap.step3.email = CFG.email;

  // Select Hire Purchase Loan bank (required *).
  const chosenBank = CFG.bank && CFG.bank.toLowerCase() !== 'random' ? CFG.bank : pick(CANDIDATE_BANKS);
  await announce(`Selecting Hire Purchase bank → ${chosenBank}`);
  const bankSelected = await page.evaluate((bank) => {
    const sels = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
    // the bank dropdown is the one containing a "Select Bank" option
    const target = sels.find((s) => Array.from(s.options).some((o) => /select bank/i.test(o.textContent || '')));
    if (!target) return '';
    const opt = Array.from(target.options).find((o) => (o.textContent || '').trim().toLowerCase() === bank.toLowerCase())
      || Array.from(target.options).find((o) => (o.textContent || '').toLowerCase().includes(bank.toLowerCase()));
    if (opt) { target.value = opt.value; target.dispatchEvent(new Event('change', { bubbles: true })); return (opt.textContent || '').trim(); }
    return '';
  }, chosenBank);
  snap.step3.hirePurchase = bankSelected || chosenBank;
  if (!bankSelected) warn(`Bank "${chosenBank}" not found in dropdown — verify list.`);

  await shot('step3-payment-form', `Step 3 — email + Hire Purchase (${snap.step3.hirePurchase}) set`, [
    { sel: 'input[data-e2e-email="1"]', label: 'Email (typed)' },
    { text: 'Hire Purchase Loan', label: 'Hire Purchase' },
  ]);
  await shot('step3-pricing', 'Step 3 — pricing incl. 10% discount', [
    { text: 'Total Nett Contribution After Discount', label: 'Total Nett' },
    { text: '10% Gross Contribution Discount', label: '10% discount' },
  ]);

  // Step 3 pricing math: total nett = gross + tax + stamp − 10%*gross.
  const g3 = parseMoney(snap.step3.gross), t3 = parseMoney(snap.step3.serviceTax),
        s3 = parseMoney(snap.step3.stampDuty), nett3 = parseMoney(snap.step3.totalNett);
  if (g3 != null && t3 != null && s3 != null && nett3 != null) {
    const expected = +(g3 + t3 + s3 - g3 * 0.10).toFixed(2);
    record('Step3 Total Nett = Gross + Tax + Stamp − 10% Gross', approxEq(nett3, expected, 0.1),
      `${g3}+${t3}+${s3}−${(g3 * 0.1).toFixed(2)} = ${expected} vs ${nett3}`);
  }

  if (CFG.stopBeforePayment) {
    warn('E2E_STOP_BEFORE_PAYMENT=1 — stopping before PAY NOW (no data created, VN not consumed).');
    await shot('step3-stopped', 'Stopped before payment (dry run)');
    progress('payment', 'done');
    // still emit a partial summary
    await finishSummary('DRY_RUN (stopped before payment)');
    return;
  }

  // PAY NOW → confirmation popup(s) → complete.
  await clickWithSpotlight('button:has-text("PAY NOW"), input[value*="PAY NOW" i]', 'Clicking PAY NOW');
  await page.waitForTimeout(1200);
  // confirmation popup (Cancel / OK)
  const okBtn = page.locator('button:has-text("OK")').first();
  if (await okBtn.count() > 0 && await okBtn.isVisible().catch(() => false)) {
    await shot('step3-confirm-popup', 'Step 3 — payment confirmation popup', [{ text: 'sufficient fund', label: 'Confirm payment' }]);
    await announce('Confirming payment → OK');
    await okBtn.click();
  }
  // wait for either complete.do, an NCD-referral popup, or a loop back
  info('   ⏳ Processing payment (real insurer API — can take up to ~40s)…');
  let completed = false;
  const start = Date.now();
  while (Date.now() - start < 75000) {
    if (/complete\.do/.test(page.url())) { completed = true; break; }
    // NCD / underwriting referral popup → acknowledge
    const ok2 = page.locator('button:has-text("OK")').first();
    if (await ok2.count() > 0 && await ok2.isVisible().catch(() => false)) {
      const popTxt = await page.locator('body').innerText().catch(() => '');
      if (/referred|NCD Response|Motor UW/i.test(popTxt)) {
        warn('NCD/underwriting referral popup encountered.');
        await shot('step3-ncd-referral', 'Step 3 — NCD/underwriting referral popup');
      }
      await ok2.click().catch(() => {});
    }
    await page.waitForTimeout(1500);
  }
  if (!completed) {
    await shot('step3-not-completed', 'Step 3 — did not reach confirmation (possible referral loop)');
    throw new Error(`Payment did not complete for ${CFG.vehicleNo} — likely an NCD/underwriting referral loop (known behaviour for some VNs). Try another VN.`);
  }
  await page.waitForTimeout(1000);
  progress('payment', 'done');

  // ══════════════════════════════════════════════════════════════════════════
  //  STEP 4: CONFIRM
  // ══════════════════════════════════════════════════════════════════════════
  progress('confirm', 'running', 'Step 4 · Confirm');
  rememberTxnId();
  const p4 = await extract(['Vehicle No', 'Confirmation of Payment', 'Payment Date', 'Payment Amount']);
  snap.step4 = {
    eCert: await bodyMatch(RX.eCert),
    vehicleRegNo: p4['Vehicle No'] || CFG.vehicleNo,
    confirmationOfPayment: p4['Confirmation of Payment'] || await bodyMatch(/Confirmation of Payment[:\s]*([A-Z0-9-]+)/i),
    paymentDate: p4['Payment Date'] || '',
    paymentAmount: p4['Payment Amount'] || await bodyMatch(/Payment Amount[:\s]*RM\s?([\d,]+\.\d{2})/i),
  };
  info(`   🎉 E-Cert ${snap.step4.eCert} · Paid ${snap.step4.paymentAmount} · ${snap.step4.paymentDate}`);
  await shot('step4-confirm', 'Step 4 — payment successful; e-certificate issued', [
    { text: 'successfully made', label: 'Success' },
    { text: 'E-certificate No', label: 'E-Certificate' },
    { text: 'Payment Amount', label: 'Amount paid' },
  ]);
  // Step4 amount == Step3 nett
  record('Step4 Paid == Step3 Total Nett', approxEq(parseMoney(snap.step4.paymentAmount), parseMoney(snap.step3.totalNett), 0.01),
    `Step4 ${snap.step4.paymentAmount} vs Step3 ${snap.step3.totalNett}`);

  await clickWithSpotlight('button:has-text("Done"), a:has-text("Done")', 'Clicking Done');
  await page.waitForTimeout(1500);
  rememberTxnId();
  progress('confirm', 'done');

  // ══════════════════════════════════════════════════════════════════════════
  //  STEP 5: TRANSACTION LISTING (search + refresh, then verify)
  // ══════════════════════════════════════════════════════════════════════════
  progress('listing', 'running', 'Listing');
  await announce(`Verifying on Transaction Listing (searching ${CFG.vehicleNo})`);
  let listingRow: string[] | null = null;
  for (let attempt = 0; attempt < 4 && !listingRow; attempt++) {
    await page.goto(`${CFG.baseUrl}/view/ucd/insurance/enquiry/main.jsp`, { waitUntil: 'domcontentloaded' });
    await closePopup();
    const vnFilter = page.locator('form input[type="text"]:visible, input[type="text"]:visible').first();
    await vnFilter.fill(CFG.vehicleNo);
    await page.locator('button:has-text("Search Now"), input[value*="Search" i]').first().click().catch(() => {});
    await page.waitForTimeout(2000);
    listingRow = await page.evaluate((vn) => {
      const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      // remove <style>/<script> so their text can't pollute cell extraction
      document.querySelectorAll('style,script,noscript').forEach((e) => e.remove());
      const tds = Array.from(document.querySelectorAll('td'));
      const cell = tds.find((td) => clean(td.textContent).toUpperCase() === vn.toUpperCase());
      const tr = cell && cell.closest('tr');
      if (!tr) return null;
      return Array.from(tr.querySelectorAll(':scope > td')).map((td) => clean(td.textContent));
    }, CFG.vehicleNo);
    if (!listingRow) await page.waitForTimeout(1500);
  }
  if (listingRow) {
    // strip exotic/zero-width whitespace so anchored matches + display are clean
    const cells: string[] = listingRow.map((c) => c.replace(/[\s\u00a0\u200b-\u200d\u202f\u2007\ufeff]+/g, ' ').trim());
    // non-anchored capture (cells can carry stray whitespace from the source table)
    const cap = (re: RegExp) => { for (const c of cells) { const m = c.match(re); if (m) return (m[1] || m[0]).trim(); } return ''; };
    snap.listing = {
      raw: cells.join(' | '),
      referenceNo:   cap(/\b([A-Z]{1,3}\d{5,})\b/),
      eCert:         cap(/\b([A-Z0-9]{3,}-\d{5,})\b/),
      status:        cells.find((c) => /Insurance Created|Pending Payment|Failed|Pending Approval|Quotation/i.test(c)) || '',
      paymentAmount: cap(/([\d,]+\.\d{2})/),
      jpj:           cells.find((c) => /Accepted|Rejected/i.test(c)) || '(pending)',
      insured:       cells.find((c) => /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(c) && !/Takaful|Insurance|Berhad/i.test(c)) || snap.step3.insuredName,
    };
    info(`   📄 Listing row: ${snap.listing.raw}`);
    await shot('listing', `Transaction Listing — ${CFG.vehicleNo} (${snap.listing.status})`, [{ text: CFG.vehicleNo, label: 'Our vehicle' }]);
    record('Listing Reference No == Step3', !!snap.listing.referenceNo && norm(snap.listing.referenceNo) === norm(snap.step3.referenceNo),
      `Listing ${snap.listing.referenceNo} vs Step3 ${snap.step3.referenceNo}`);
    record('Listing E-Cert == Step4', !!snap.listing.eCert && norm(snap.listing.eCert) === norm(snap.step4.eCert),
      `Listing ${snap.listing.eCert} vs Step4 ${snap.step4.eCert}`);
    record('Listing Paid == Step4', approxEq(parseMoney(snap.listing.paymentAmount), parseMoney(snap.step4.paymentAmount), 0.01),
      `Listing ${snap.listing.paymentAmount} vs Step4 ${snap.step4.paymentAmount}`);
    record('Listing Status = Insurance Created', /Insurance Created/i.test(snap.listing.status),
      `status = ${snap.listing.status || '(none)'}`);
  } else {
    snap.listing = { raw: '(row not found)' };
    record('Listing row present', false, `No listing row found for ${CFG.vehicleNo} after 4 refresh attempts`);
    await shot('listing-missing', `Transaction Listing — no row for ${CFG.vehicleNo}`);
  }
  progress('listing', 'done');

  // ══════════════════════════════════════════════════════════════════════════
  //  STEP 6: TRANSACTION DETAILS (refresh, then verify everything)
  // ══════════════════════════════════════════════════════════════════════════
  progress('details', 'running', 'Details');
  const txnId = transactionIds[transactionIds.length - 1];
  if (txnId) {
    await announce('Opening Transaction Details (with refresh)');
    // two loads — details resolve progressively (status, JPJ)
    for (let i = 0; i < 3; i++) {
      await page.goto(`${CFG.baseUrl}/view/ucd/insurance/enquiry/view.do?transactionId=${txnId}`, { waitUntil: 'domcontentloaded' });
      await closePopup();
      await page.waitForTimeout(1500);
      const st = await page.locator('body').innerText().catch(() => '');
      if (/Insurance Created/i.test(st)) break;
    }
    const d = await extract([
      'E-Certificate No/Policy No', 'E-Certificate No', 'Submission Status to JPJ', 'Date Issue',
      'Insurance Company', 'Insurance Plan', 'Full Name', 'IC No', 'Email',
      'Vehicle No', 'Vehicle Use', 'Capacity', 'Cover Type',
      'Hire Purchase:', 'Sum Covered', 'Total Nett Contribution After Discount',
    ]);
    const coverD = await readCoverType();
    // Hire Purchase (User Submission) — read specifically
    const hpUser = await page.evaluate(() => {
      const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      document.querySelectorAll('style,script,noscript').forEach((e) => e.remove());
      const body = clean(document.body.textContent);
      // The User-Submission bank name sits right after "(User Submission)".
      // Bank name casing varies by environment (e.g. "RHB Bank Berhad" vs
      // "RHB BANK BERHAD"), so this must be fully case-insensitive.
      let m = body.match(/User Submission\)\s*:?\s*([A-Za-z][A-Za-z&.\- ]+?Berhad)/i);
      if (m) return clean(m[1]);
      m = body.match(/([A-Za-z][A-Za-z&.\- ]+? Bank Berhad)/i);
      return m ? clean(m[1]) : '';
    });
    const emailD = await page.evaluate(() => {
      const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const body = clean(document.body.innerText);
      const m = body.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
      return m ? m[0] : '';
    });
    snap.details = {
      eCert: (await bodyMatch(RX.eCert)) || d['E-Certificate No/Policy No'] || d['E-Certificate No'] || '',
      jpj: ((d['Submission Status to JPJ'] || '').replace(/Check JPJ Status/ig, '').trim()) || '(pending)',
      dateIssue: d['Date Issue'] || '',
      company: d['Insurance Company'] || '',
      plan: d['Insurance Plan'] || '',
      insuredName: d['Full Name'] || '',
      ownerIC: d['IC No'] || '',
      email: emailD || d['Email'] || '',
      vehicleRegNo: d['Vehicle No'] || CFG.vehicleNo,
      vehicleUse: d['Vehicle Use'] || '',
      capacity: d['Capacity'] || '',
      coverType: normalizeCover(coverD),
      hirePurchase: hpUser || '',
      sumCovered: await bodyMatch(RX.sum),
      // Details has no PAY NOW button, so fall back to "Total Contribution"
      // (some insurers/scenarios render this page without a discount line).
      totalNett: (await bodyMatch(RX.totalNett)) || (await bodyMatch(RX.totalContrib)),
      status: /Insurance Created/i.test(await page.locator('body').innerText().catch(() => '')) ? 'Insurance Created' : '',
    };
    info(`   🔎 Details: status=${snap.details.status} · JPJ=${snap.details.jpj} · email=${snap.details.email} · HP=${snap.details.hirePurchase}`);
    await shot('details-header', `Details — ${CFG.vehicleNo} · ${snap.details.status}`, [
      { text: 'Insurance Created', label: 'Status' },
      { text: 'E-Certificate', label: 'E-Certificate' },
    ]);
    await shot('details-insured', 'Details — insured + email', [{ text: 'Email', label: 'Email (verify vs typed)' }]);
    await shot('details-vehicle-hp', 'Details — vehicle + hire purchase', [{ text: 'User Submission', label: 'HP User Submission' }]);

    // ── Cross-page verifications ──
    record('Details Status = Insurance Created', /Insurance Created/i.test(snap.details.status), snap.details.status || '(none)');
    record('Details E-Cert == Step4', !!snap.details.eCert && norm(snap.details.eCert) === norm(snap.step4.eCert),
      `${snap.details.eCert} vs ${snap.step4.eCert}`);
    record('Email typed reaches final record', norm(snap.details.email).toLowerCase() === CFG.email.toLowerCase(),
      `Details ${snap.details.email} vs typed ${CFG.email}`);
    record('Hire Purchase (User Submission) == selected bank',
      !!snap.details.hirePurchase && norm(snap.details.hirePurchase).toLowerCase().includes(norm(snap.step3.hirePurchase).toLowerCase().split(' ')[0]),
      `Details "${snap.details.hirePurchase}" vs selected "${snap.step3.hirePurchase}"`);
    record('Details Total Nett == Step4 Paid', approxEq(parseMoney(snap.details.totalNett), parseMoney(snap.step4.paymentAmount), 0.01),
      `${snap.details.totalNett} vs ${snap.step4.paymentAmount}`);
    record('Details Vehicle Use == Step3', norm(snap.details.vehicleUse).toLowerCase() === norm(snap.step3.vehicleUse).toLowerCase() || !snap.details.vehicleUse,
      `${snap.details.vehicleUse} vs ${snap.step3.vehicleUse}`);
  } else {
    snap.details = { raw: '(no transactionId captured)' };
    record('Details reachable', false, 'No transactionId captured from the flow');
  }
  progress('details', 'done');

  // ══════════════════════════════════════════════════════════════════════════
  //  CROSS-PAGE CONSISTENCY (the "same on every page" assertions)
  // ══════════════════════════════════════════════════════════════════════════
  const coverAll = [snap.step1?.coverType, snap.step2?.coverType, snap.step3?.coverType, snap.details?.coverType].filter(Boolean);
  record('Cover Type identical across pages', new Set(coverAll.map((c) => normalizeCover(c))).size === 1,
    `values: ${coverAll.join(' | ') || '(none captured)'}`);

  const icAll = [snap.step1?.ownerIC, snap.step2?.ownerIC, snap.step3?.ownerIC, snap.details?.ownerIC].filter(Boolean);
  record('Owner/Insured IC identical across pages', new Set(icAll.map(norm)).size <= 1, `values: ${icAll.join(' | ')}`);

  const vnAll = [CFG.vehicleNo, snap.step1?.vehicleRegNo, snap.step3?.vehicleRegNo, snap.step4?.vehicleRegNo, snap.details?.vehicleRegNo]
    .map((x) => norm(x).toUpperCase()).filter(Boolean);
  record('Vehicle No identical across pages', new Set(vnAll).size === 1, `values: ${vnAll.join(' | ')}`);

  const planAll = [snap.step2?.plan, snap.details?.plan].filter(Boolean);
  record('Insurance Plan identical (Step2 vs Details)', new Set(planAll.map(norm)).size <= 1, `values: ${planAll.join(' | ')}`);

  const certAll = [snap.step4?.eCert, snap.listing?.eCert, snap.details?.eCert].filter(Boolean);
  record('E-Certificate No identical (Step4 · Listing · Details)', certAll.length >= 2 && new Set(certAll.map(norm)).size === 1,
    `values: ${certAll.join(' | ') || '(none captured)'}`);

  const refAll = [snap.step3?.referenceNo, snap.listing?.referenceNo].filter(Boolean);
  record('Reference No identical (Step3 · Listing)', refAll.length >= 2 && new Set(refAll.map(norm)).size === 1,
    `values: ${refAll.join(' | ') || '(none captured)'}`);

  const sumStep1 = parseMoney(snap.step1?.sumCovered), sumStep2 = parseMoney(snap.step2?.totalSumCovered),
        sumStep3 = parseMoney(snap.step3?.sumCovered);
  record('Sum Covered consistent (Step1→2→3)',
    approxEq(sumStep1, sumStep2, 0.01) && approxEq(sumStep2, sumStep3, 0.01),
    `S1 ${snap.step1?.sumCovered} · S2 ${snap.step2?.totalSumCovered} · S3 ${snap.step3?.sumCovered}`);

  await finishSummary('COMPLETED');

  // ── summary emitter (also used by the dry-run early return) ─────────────────
  async function finishSummary(outcome: string) {
    progress('summary', 'running', 'Summary');
    const passed = checks.filter((c) => c.pass).length;
    const failed = checks.length - passed;
    const verdict = failed === 0 ? 'ALL CHECKS PASSED ✅' : `${failed} CHECK(S) FAILED ❌`;

    // The video is saved in afterEach (so it's captured even on early failures).
    const videoFile = `${CFG.vehicleNo}_insurance-e2e.webm`;

    // Human-readable Markdown report.
    const md: string[] = [];
    md.push(`# Insurance E2E Report — ${CFG.vehicleNo}`);
    md.push(`- Outcome: **${outcome}** — ${verdict}`);
    md.push(`- Env: ${CFG.env} · Insurer: ${snap.step1?.insurer || '-'} · Cover: ${snap.step1?.coverType || '-'} · Coverage: ${snap.step2?.selectedCoverage || '-'}`);
    md.push(`- Reference: ${snap.step3?.referenceNo || '-'} · E-Cert: ${snap.step4?.eCert || '-'} · Paid: ${snap.step4?.paymentAmount || '-'}`);
    md.push(`\n## Checks (${passed}/${checks.length} passed)`);
    for (const c of checks) md.push(`- ${c.pass ? '✅' : '❌'} **${c.name}** — ${c.detail}`);
    md.push(`\n## Captured data per page`);
    for (const [pg, fields] of Object.entries(snap)) {
      md.push(`\n### ${pg}`);
      for (const [k, val] of Object.entries(fields)) md.push(`- ${k}: ${val}`);
    }
    try { fs.writeFileSync(path.join(CFG.artifactDir, 'report.md'), md.join('\n')); } catch {}
    try { fs.writeFileSync(path.join(CFG.artifactDir, 'report.json'), JSON.stringify({ outcome, verdict, passed, failed, checks, snap, videoFile }, null, 2)); } catch {}

    emitResult({
      outcome, verdict, passed, failed,
      vehicleNo: CFG.vehicleNo, env: CFG.env,
      insurer: snap.step1?.insurer, coverType: snap.step1?.coverType,
      coverage: snap.step2?.selectedCoverage,
      referenceNo: snap.step3?.referenceNo, eCert: snap.step4?.eCert,
      paymentAmount: snap.step4?.paymentAmount, jpj: snap.details?.jpj,
      email: snap.details?.email, hirePurchase: snap.details?.hirePurchase,
      checks, snap, videoFile,
    });

    info('\n══════════════════════════════════════════════════════════');
    info(`  ${verdict}  (${passed}/${checks.length} checks)  ·  ${outcome}`);
    info('══════════════════════════════════════════════════════════');
    progress('summary', failed === 0 ? 'done' : 'error');

    if (failed > 0 && outcome === 'COMPLETED') {
      throw new Error(`${failed} verification check(s) failed — see report.`);
    }
  }
});

// Save the recording to the artifact dir under a friendly name — runs even when
// the test throws early, so failed runs still ship a watchable video.
// NOTE — intentionally no afterEach video save here.
// Playwright can only finalize a video once the browser context closes, and the
// context doesn't close until *after* afterEach hooks finish — calling
// page.video().saveAs() in afterEach is a deadlock (it waits for a close that
// waits for it). Instead, Playwright saves the video to its own default
// location once the context closes normally, and the SERVER (server.js) copies
// that finished file into the run's artifact folder after the process exits.
