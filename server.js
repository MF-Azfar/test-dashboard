const express = require('express');
const { spawn }  = require('child_process');
const path       = require('path');
const fs         = require('fs');
const ExcelJS    = require('exceljs');
const os         = require('os');

const app  = express();
const PORT = 3000;

// ── Project paths (relative — works on any machine after cloning) ─────────────
const INSURANCE_DIR = path.join(__dirname, 'insurance');
const ESTM_DIR      = path.join(__dirname, 'estm');

// Use the @playwright/test CLI JS directly — no .cmd, no npx, no shell needed
const INS_PW_CLI  = path.join(INSURANCE_DIR, 'node_modules', '@playwright', 'test', 'cli.js');
const ESTM_PW_CLI = path.join(ESTM_DIR,      'node_modules', '@playwright', 'test', 'cli.js');
const NODE_EXE    = process.execPath;   // full path to node.exe running this server

// ── Middleware ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Process tracking ─────────────────────────────────────────────────────────
let activeProcess  = null;   // the running playwright child
let activeJobDone  = false;  // true once the child exits naturally

function killActive() {
  if (activeProcess) {
    try { activeProcess.kill(); } catch {}
    activeProcess = null;
  }
}

// ── SSE helpers ───────────────────────────────────────────────────────────────
function sseSetup(res) {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
}
function sseSend(res, event, data) {
  if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── Excel helpers ─────────────────────────────────────────────────────────────
async function writeVehicleExcel(vehicles, filePath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Vehicles');
  ws.columns = [
    { header: 'Vehicle Number',   key: 'vn',  width: 18 },
    { header: 'IC Number',        key: 'ic',  width: 18 },
    { header: 'Postcode',         key: 'pc',  width: 12 },
    { header: 'Vehicle Category', key: 'cat', width: 18 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const v of vehicles) {
    ws.addRow({ vn: v.vehicleNumber||'', ic: v.icNumber||'', pc: v.postcode||'', cat: v.vehicleCategory||'' });
  }
  await wb.xlsx.writeFile(filePath);
}

async function readResultExcel(filePath) {
  if (!fs.existsSync(filePath)) return { summary: [], skipped: [] };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const summary = [], skipped = [];

  const ss = wb.getWorksheet('Summary');
  if (ss) ss.eachRow((row, i) => {
    if (i === 1) return;
    const vn = row.getCell(1).text?.trim();
    if (!vn) return;
    summary.push({
      vehicleNumber: vn,
      make:          row.getCell(2).text?.trim()  || '',
      model:         row.getCell(3).text?.trim()  || '',
      mfgYear:       row.getCell(4).text?.trim()  || '',
      engineCC:      row.getCell(5).text?.trim()  || '',
      transmission:  row.getCell(6).text?.trim()  || '',
      variant:       row.getCell(7).text?.trim()  || '',
      insurer:       row.getCell(8).text?.trim()  || '',
      coverType:     row.getCell(9).text?.trim()  || '',
      allowPurchase: row.getCell(10).text?.trim() || '',
      referRiskCode: row.getCell(11).text?.trim() || '',
      totalPrice:    row.getCell(12).text?.trim() || '',
    });
  });

  const sk = wb.getWorksheet('Skipped Vehicles');
  if (sk) sk.eachRow((row, i) => {
    if (i === 1) return;
    const vn = row.getCell(1).text?.trim();
    if (!vn) return;
    skipped.push({ vehicleNumber: vn, status: row.getCell(2).text?.trim()||'', reason: row.getCell(3).text?.trim()||'' });
  });
  return { summary, skipped };
}

// ── Write formatted result Excel (for download) ───────────────────────────────
async function writeResultExcel(summary, skipped, filePath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'eAuto QA Platform';
  wb.created = new Date();

  const ss = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  ss.columns = [
    { header: 'Vehicle Number',  key: 'vehicleNumber', width: 18 },
    { header: 'Make',            key: 'make',          width: 14 },
    { header: 'Model',           key: 'model',         width: 28 },
    { header: 'Mfg Year',        key: 'mfgYear',       width: 10 },
    { header: 'Engine CC',       key: 'engineCC',      width: 11 },
    { header: 'Transmission',    key: 'transmission',  width: 16 },
    { header: 'Variant',         key: 'variant',       width: 22 },
    { header: 'Insurer',         key: 'insurer',       width: 20 },
    { header: 'Cover Type',      key: 'coverType',     width: 32 },
    { header: 'Allow Purchase',  key: 'allowPurchase', width: 15 },
    { header: 'Refer Risk Code', key: 'referRiskCode', width: 40 },
    { header: 'Total Price',     key: 'totalPrice',    width: 14 },
  ];
  const hdr = ss.getRow(1);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
  hdr.alignment = { vertical: 'middle', horizontal: 'center' };

  for (const r of summary) {
    const row = ss.addRow(r);
    const cell = row.getCell('allowPurchase');
    const yes = (r.allowPurchase || '').toLowerCase().includes('yes');
    cell.font = { bold: true, color: { argb: yes ? 'FF008000' : 'FFFF0000' } };
  }
  if (ss.rowCount > 1) ss.autoFilter = { from: { row: 1, column: 1 }, to: { row: ss.rowCount, column: 12 } };

  const sk = wb.addWorksheet('Skipped Vehicles', { views: [{ state: 'frozen', ySplit: 1 }] });
  sk.columns = [
    { header: 'Vehicle Number', key: 'vehicleNumber', width: 18 },
    { header: 'Status',         key: 'status',        width: 20 },
    { header: 'Reason',         key: 'reason',        width: 60 },
  ];
  sk.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sk.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
  for (const r of skipped) sk.addRow(r);

  await wb.xlsx.writeFile(filePath);
}

// ── Run one chunk of vehicles in its own browser instance ─────────────────────
function runInsuranceChunk(chunk, config, workerIdx, sseRes) {
  return new Promise(async (resolve) => {
    const ts         = Date.now();
    const tempDir    = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const inputPath  = path.join(tempDir, `input-w${workerIdx}-${ts}.xlsx`);
    const outputPath = path.join(tempDir, `output-w${workerIdx}-${ts}.xlsx`);

    try { await writeVehicleExcel(chunk, inputPath); } catch (err) {
      resolve({ summary: [], skipped: chunk.map(v => ({ vehicleNumber: v.vehicleNumber, status: 'ERROR', reason: `Write failed: ${err.message}` })) });
      return;
    }

    const isHeadless = config.mode === 'headless';
    // Headless visibility is driven by the INS_HEADLESS env var (read by playwright.config.ts),
    // NOT by the --headed CLI flag — so the config and our intent never conflict.
    const args = [INS_PW_CLI, 'test', 'insurance-checker.spec.ts', '--workers=1', '--reporter=list'];

    // In headless mode there is no rendering, so we can safely tighten the fixed
    // safety waits for a real speed boost. Headed keeps the original safe timings.
    const tighterWaits = isHeadless
      ? { INS_WAIT_PAGE: '1500', INS_WAIT_CLICK: '2500', INS_POLL: '1500' }
      : {};

    const child = spawnPlaywright(args, INSURANCE_DIR, {
      INS_HEADLESS:    isHeadless ? 'true' : 'false',
      INS_BASE_URL:    `https://staging.eauto.my/${config.env}`,
      INS_USERNAME:    config.username        || 'Jasons',
      INS_PASSWORD:    config.password        || '',
      INS_IC:          config.icNumber        || '020406081081',
      INS_POSTCODE:    config.postcode        || '31150',
      INS_CATEGORY:    config.vehicleCategory || 'individual',
      INS_INPUT_FILE:  inputPath,
      INS_OUTPUT_FILE: outputPath,
      ...tighterWaits,
    });

    let buf = '';
    const tag = chunk.length === 1 ? chunk[0].vehicleNumber : `Browser ${workerIdx + 1}`;
    child.stdout.on('data', d => {
      buf += d.toString();
      const lines = buf.split('\n'); buf = lines.pop() || '';
      lines.forEach(raw => {
        const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (!line) return;
        let level = 'info';
        if (line.includes('✅') || line.includes('passed')) level = 'success';
        if (line.includes('❌') || line.includes('failed') || /error/i.test(line)) level = 'error';
        if (line.includes('⚠️')) level = 'warning';
        if (line.startsWith('·') || line.startsWith('  ✓')) level = 'muted';
        sseSend(sseRes, 'log', { text: `[${tag}] ${line}`, level });
      });
    });
    child.stderr.on('data', () => {});

    child.on('close', async (code) => {
      if (buf.trim()) {
        const line = buf.replace(/\x1b\[[0-9;]*m/g,'').trim();
        if (line) sseSend(sseRes, 'log', { text: `[${tag}] ${line}`, level: 'info' });
      }
      try { fs.unlinkSync(inputPath); } catch {}

      if (code === 0) {
        try {
          const results = await readResultExcel(outputPath);
          try { fs.unlinkSync(outputPath); } catch {}
          resolve(results);
        } catch (err) {
          try { fs.unlinkSync(outputPath); } catch {}
          resolve({ summary: [], skipped: chunk.map(v => ({ vehicleNumber: v.vehicleNumber, status: 'ERROR', reason: `Read failed: ${err.message}` })) });
        }
      } else {
        try { fs.unlinkSync(outputPath); } catch {}
        resolve({ summary: [], skipped: chunk.map(v => ({ vehicleNumber: v.vehicleNumber, status: 'ERROR', reason: `Browser ${workerIdx + 1} exited with code ${code}` })) });
      }
    });

    child.on('error', err => {
      resolve({ summary: [], skipped: chunk.map(v => ({ vehicleNumber: v.vehicleNumber, status: 'ERROR', reason: err.message })) });
    });
  });
}

// ── Spawn helper ──────────────────────────────────────────────────────────────
function spawnPlaywright(args, cwd, extraEnv) {
  const env = {
    ...process.env,
    FORCE_COLOR:              '0',
    PLAYWRIGHT_HTML_OPEN:     'never',
    PW_TEST_HTML_REPORT_OPEN: 'never',
    ...extraEnv,
  };
  return spawn(NODE_EXE, args, {
    cwd,
    env,
    shell:       false,
    detached:    false,   // detached:true forces a new console window on Windows (the black box)
    windowsHide: true,    // suppress the console window for the node process
  });
}

// ── Line processor ────────────────────────────────────────────────────────────
function makeLineProcessor(res, onProgress, onResult) {
  return function processLine(raw) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!line) return;

    if (line.includes('PROGRESS:')) {
      try { onProgress && onProgress(JSON.parse(line.split('PROGRESS:')[1])); } catch {}
      return;
    }
    if (line.includes('RESULT:')) {
      try { onResult && onResult(JSON.parse(line.split('RESULT:')[1])); } catch {}
      return;
    }

    let level = 'info';
    if (line.includes('✅') || line.includes('passed')) level = 'success';
    if (line.includes('❌') || line.includes('failed') || /error/i.test(line)) level = 'error';
    if (line.includes('⚠️')) level = 'warning';
    if (line.startsWith('·') || line.startsWith('  ✓') || line.startsWith('  ✗')) level = 'muted';
    sseSend(res, 'log', { text: line, level });
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => res.json({ ok: true, running: !!activeProcess }));

app.post('/api/stop', (req, res) => { killActive(); res.json({ ok: true }); });

// ── eSTM run ──────────────────────────────────────────────────────────────────
app.post('/api/estm/run', (req, res) => {
  sseSetup(res);

  const { config } = req.body || {};
  if (!config?.env)          { sseSend(res,'error',{text:'Staging environment required.'}); return res.end(); }
  if (!config?.vehicleRegNo) { sseSend(res,'error',{text:'Vehicle registration number required.'}); return res.end(); }
  if (!config?.email)        { sseSend(res,'error',{text:'Email address required.'}); return res.end(); }
  if (!config?.mobile)       { sseSend(res,'error',{text:'Mobile number required.'}); return res.end(); }

  killActive();

  sseSend(res, 'log',    { text:`🚀 Starting eSTM for ${config.vehicleRegNo} on ${config.env}…`, level:'info' });
  sseSend(res, 'status', { status:'running' });

  const args = [
    ESTM_PW_CLI, 'test', 'tests/estm-bypass-test.spec.ts',
    '--project=chromium', '--headed', '--workers=1', '--reporter=list',
  ];

  const child = spawnPlaywright(args, ESTM_DIR, {
    ESTM_ENV_SEGMENT:    config.env,
    ESTM_USERNAME:       config.username    || 'azfar1',
    ESTM_PASSWORD:       config.password    || '123456',
    ESTM_ID_TYPE:        config.idType      || '1',
    ESTM_VEHICLE_REG_NO: config.vehicleRegNo,
    ESTM_EMAIL_ADDRESS:  config.email,
    ESTM_MOBILE_NO:      config.mobile,
    ESTM_SKIP_PAUSE:     '1',
  });

  activeProcess = child;
  activeJobDone = false;

  const processLine = makeLineProcessor(
    res,
    data => sseSend(res, 'progress', data),
    data => sseSend(res, 'result',   data),
  );

  let buf = '';
  child.stdout.on('data', d => {
    buf += d.toString();
    const lines = buf.split('\n'); buf = lines.pop() || '';
    lines.forEach(processLine);
  });
  child.stderr.on('data', d => {
    d.toString().split('\n').forEach(l => {
      l = l.replace(/\x1b\[[0-9;]*m/g,'').trim();
      if (l && !l.includes('DeprecationWarning') && !l.includes('ExperimentalWarning'))
        sseSend(res, 'log', { text: `[err] ${l}`, level: l.toLowerCase().includes('error') ? 'error' : 'muted' });
    });
  });

  child.on('close', (code, signal) => {
    if (buf.trim()) processLine(buf);
    activeProcess  = null;
    activeJobDone  = true;
    const ok = (code === 0);
    sseSend(res, 'log',    { text: ok ? '✅ eSTM flow completed!' : `Process ended — code=${code} signal=${signal}`, level: ok ? 'success' : 'error' });
    sseSend(res, 'status', { status: ok ? 'done' : 'error' });
    res.end();
  });

  child.on('error', err => {
    sseSend(res, 'error',  { text:`Failed to start Playwright: ${err.message}` });
    sseSend(res, 'status', { status:'error' });
    activeProcess = null;
    res.end();
  });

  // Only kill on disconnect if the job hasn't finished yet
  req.on('close', () => {
    if (!activeJobDone && activeProcess === child) {
      console.log('[server] Client disconnected — keeping playwright running');
      // Do NOT kill — let the browser run to completion
    }
  });
});

// ── Insurance run (parallel workers) ─────────────────────────────────────────
app.post('/api/insurance/run', async (req, res) => {
  sseSetup(res);

  const { vehicles, config } = req.body || {};
  if (!vehicles?.length) { sseSend(res,'error',{text:'No vehicles provided.'}); return res.end(); }

  killActive();

  const numWorkers  = Math.min(Math.max(parseInt(config.workers) || 1, 1), 5);
  const actualW     = Math.min(numWorkers, vehicles.length);
  const chunkSize   = Math.ceil(vehicles.length / actualW);
  const chunks      = [];
  for (let i = 0; i < actualW; i++) {
    const c = vehicles.slice(i * chunkSize, (i + 1) * chunkSize);
    if (c.length) chunks.push(c);
  }

  sseSend(res, 'log',    { text: `🚀 ${vehicles.length} vehicle(s) across ${chunks.length} concurrent browser(s)…`, level: 'info' });
  sseSend(res, 'status', { status: 'running' });

  // Stagger each worker by 3s so logins don't slam the server simultaneously
  const workerPromises = chunks.map((chunk, i) => new Promise(async resolve => {
    if (i > 0) await new Promise(r => setTimeout(r, i * 3000));
    sseSend(res, 'log', { text: `🌐 Browser ${i + 1} starting — ${chunk.length} vehicle(s)…`, level: 'info' });
    const result = await runInsuranceChunk(chunk, config, i, res);
    const quotes = result.summary.length;
    sseSend(res, 'log', { text: `✅ Browser ${i + 1} finished — ${quotes} quote(s) found`, level: 'success' });
    sseSend(res, 'progress', { worker: i + 1, done: true, quotes });
    resolve(result);
  }));

  const chunkResults = await Promise.all(workerPromises);

  const allSummary = chunkResults.flatMap(r => r.summary);
  const allSkipped = chunkResults.flatMap(r => r.skipped);

  // Save Excel to Downloads folder
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  const dateStr   = new Date().toISOString().slice(0, 10);
  const filename  = `Insurance-Results-${dateStr}-${Date.now()}.xlsx`;
  const xlsxPath  = path.join(downloadsDir, filename);
  try {
    await writeResultExcel(allSummary, allSkipped, xlsxPath);
    sseSend(res, 'log',      { text: `📥 Excel saved → Downloads/${filename}`, level: 'success' });
    sseSend(res, 'download', { filename, path: xlsxPath });
  } catch (err) {
    sseSend(res, 'log', { text: `⚠️ Could not save Excel: ${err.message}`, level: 'warning' });
  }

  const uniqV = new Set(allSummary.map(r => r.vehicleNumber)).size;
  sseSend(res, 'log',     { text: `📊 Done — ${allSummary.length} quotes for ${uniqV} vehicle(s), ${allSkipped.length} skipped`, level: 'success' });
  sseSend(res, 'results', { summary: allSummary, skipped: allSkipped });
  sseSend(res, 'status',  { status: 'done' });
  res.end();
});

// ── Startup checks ────────────────────────────────────────────────────────────
process.on('uncaughtException', err => console.error('[uncaughtException]', err));
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

[['Insurance CLI', INS_PW_CLI], ['eSTM CLI', ESTM_PW_CLI]].forEach(([label, p]) =>
  console.log(`${fs.existsSync(p) ? '✅' : '❌'} ${label}: ${p}`)
);

// ── Knowledge Base persistence (local JSON file, server-side so the AI can read it) ──
const DATA_DIR  = path.join(__dirname, 'data');
const KB_FILE   = path.join(DATA_DIR, 'knowledge.json');

function readKB() {
  try {
    if (fs.existsSync(KB_FILE)) return JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
  } catch (e) { console.error('[KB] read error:', e.message); }
  return { entries: [], settings: {} };
}
function writeKB(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// GET full knowledge base (entries + settings)
app.get('/api/knowledge', (req, res) => {
  res.json(readKB());
});

// POST to replace the whole knowledge base document
app.post('/api/knowledge', (req, res) => {
  try {
    const { entries, settings } = req.body || {};
    writeKB({
      entries:  Array.isArray(entries) ? entries : [],
      settings: settings && typeof settings === 'object' ? settings : {},
      updatedAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Jira integration (reads creds from the saved knowledge base) ─────────────
function jiraConf() {
  const s = readKB().settings || {};
  if (!s.jiraDomain || !s.jiraEmail || !s.jiraToken) return null;
  const host = s.jiraDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    base: 'https://' + host,
    auth: 'Basic ' + Buffer.from(s.jiraEmail + ':' + s.jiraToken).toString('base64'),
  };
}

async function jiraSearch(conf, jql, fields = 'summary,status,issuetype', max = 50) {
  const url = conf.base + '/rest/api/3/search/jql?jql=' + encodeURIComponent(jql) +
              '&maxResults=' + max + '&fields=' + fields;
  const r = await fetch(url, { headers: { Authorization: conf.auth, Accept: 'application/json' } });
  if (!r.ok) throw new Error('Jira ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return (await r.json()).issues || [];
}

function mapIssue(conf, i) {
  return {
    key: i.key,
    summary: i.fields.summary || '',
    status: i.fields.status?.name || '',
    statusCat: i.fields.status?.statusCategory?.key || 'new',
    type: i.fields.issuetype?.name || '',
    url: conf.base + '/browse/' + i.key,
  };
}

app.get('/api/jira/me', async (req, res) => {
  const conf = jiraConf();
  if (!conf) return res.json({ ok: false, error: 'Jira not configured. Add domain, email & token in Knowledge Base → Settings.' });
  try {
    const r = await fetch(conf.base + '/rest/api/3/myself', { headers: { Authorization: conf.auth, Accept: 'application/json' } });
    if (!r.ok) return res.json({ ok: false, error: 'Auth failed (' + r.status + '). Check email/token.' });
    const m = await r.json();
    res.json({ ok: true, displayName: m.displayName, accountId: m.accountId, email: m.emailAddress });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/jira/overview', async (req, res) => {
  const conf = jiraConf();
  if (!conf) return res.json({ ok: false, error: 'Jira not configured. Add domain, email & token in Knowledge Base → Settings.' });
  try {
    const meR = await fetch(conf.base + '/rest/api/3/myself', { headers: { Authorization: conf.auth, Accept: 'application/json' } });
    if (!meR.ok) return res.json({ ok: false, error: 'Auth failed (' + meR.status + '). Check email/token.' });
    const me = await meR.json();

    const raised = await jiraSearch(conf, 'reporter = currentUser() AND created >= startOfDay() ORDER BY created DESC');
    const assigned = await jiraSearch(conf, 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC');

    // "Done/Closed today" — try Done+Closed, fall back to just Done if a status name is invalid
    let doneCount = 0;
    for (const jql of [
      'status CHANGED TO ("Done","Closed") BY currentUser() DURING (startOfDay(), now())',
      'status CHANGED TO ("Done") BY currentUser() DURING (startOfDay(), now())',
    ]) {
      try { doneCount = (await jiraSearch(conf, jql, 'summary', 50)).length; break; } catch (e) { /* try next */ }
    }

    res.json({
      ok: true,
      me: { displayName: me.displayName, accountId: me.accountId },
      raisedToday: { count: raised.length, issues: raised.map(i => mapIssue(conf, i)) },
      doneToday:   { count: doneCount },
      assignedOpen:{ count: assigned.length, issues: assigned.map(i => mapIssue(conf, i)) },
    });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/jira/children', async (req, res) => {
  const conf = jiraConf();
  if (!conf) return res.json({ ok: false, error: 'Jira not configured.' });
  const key = (req.query.key || '').toString().trim().toUpperCase();
  if (!key) return res.json({ ok: false, error: 'Provide a ticket key, e.g. EAINT-8606.' });
  try {
    // parent issue info + its children (subtasks / child issues)
    const parentR = await fetch(conf.base + '/rest/api/3/issue/' + encodeURIComponent(key) + '?fields=summary,status,issuetype',
      { headers: { Authorization: conf.auth, Accept: 'application/json' } });
    if (!parentR.ok) return res.json({ ok: false, error: 'Ticket ' + key + ' not found (' + parentR.status + ').' });
    const parent = await parentR.json();
    const children = await jiraSearch(conf, 'parent = "' + key + '" ORDER BY status ASC, created DESC', 'summary,status,issuetype', 100);
    res.json({
      ok: true,
      parent: mapIssue(conf, parent),
      children: children.map(i => mapIssue(conf, i)),
    });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── AI brain (Option A: Claude Code CLI headless — uses existing login, no API key) ──
const CLAUDE_EXE = (() => {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
  ];
  return candidates.find(p => p && fs.existsSync(p)) || null;
})();

function callClaude(instruction, context, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    if (!CLAUDE_EXE) return reject(new Error('Claude Code CLI not found. Install: npm i -g @anthropic-ai/claude-code, then log in.'));
    const child = spawn(CLAUDE_EXE, ['-p', instruction, '--output-format', 'text'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const to = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('AI timed out after ' + (timeoutMs/1000) + 's')); }, timeoutMs);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(to); reject(e); });
    child.stdin.write(context); child.stdin.end();
    child.on('close', code => { clearTimeout(to); code === 0 ? resolve(out) : reject(new Error('AI exited ' + code + ': ' + err.slice(0, 300))); });
  });
}

function parseJsonLoose(s) {
  const t = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(t); }
  catch (e) { const m = t.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('Could not parse AI output as JSON'); }
}

// Atlassian Document Format → plain text
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  let s = '';
  if (node.text) s += node.text;
  if (Array.isArray(node.content)) s += node.content.map(adfToText).join('');
  if (['paragraph', 'heading', 'listItem', 'blockquote'].includes(node.type)) s += '\n';
  if (node.type === 'hardBreak') s += '\n';
  return s;
}

// Full ticket detail
app.get('/api/jira/issue', async (req, res) => {
  const conf = jiraConf();
  if (!conf) return res.json({ ok: false, error: 'Jira not configured.' });
  const key = (req.query.key || '').toString().trim().toUpperCase();
  if (!key) return res.json({ ok: false, error: 'Provide a ticket key.' });
  try {
    const r = await fetch(conf.base + '/rest/api/3/issue/' + encodeURIComponent(key) + '?fields=summary,description,status,issuetype',
      { headers: { Authorization: conf.auth, Accept: 'application/json' } });
    if (!r.ok) return res.json({ ok: false, error: 'Ticket ' + key + ' not found (' + r.status + ').' });
    const i = await r.json();
    res.json({
      ok: true,
      key: i.key,
      summary: i.fields.summary || '',
      description: adfToText(i.fields.description).replace(/\n{3,}/g, '\n\n').trim(),
      status: i.fields.status?.name || '',
      type: i.fields.issuetype?.name || '',
      url: conf.base + '/browse/' + i.key,
    });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Generate a test plan from a ticket
app.post('/api/ai/plan', async (req, res) => {
  const conf = jiraConf();
  const key = (req.body?.key || '').toString().trim().toUpperCase();
  if (!conf) return res.json({ ok: false, error: 'Jira not configured.' });
  if (!key)  return res.json({ ok: false, error: 'Provide a ticket key.' });

  try {
    // 1. fetch ticket
    const r = await fetch(conf.base + '/rest/api/3/issue/' + encodeURIComponent(key) + '?fields=summary,description,status,issuetype',
      { headers: { Authorization: conf.auth, Accept: 'application/json' } });
    if (!r.ok) return res.json({ ok: false, error: 'Ticket ' + key + ' not found (' + r.status + ').' });
    const i = await r.json();
    const ticket = {
      key: i.key,
      summary: i.fields.summary || '',
      description: adfToText(i.fields.description).replace(/\n{3,}/g, '\n\n').trim(),
    };

    // 2. relevant knowledge base context
    const kb = readKB().entries || [];
    const relevant = kb.filter(e => ['Business Rules', 'Test Conventions', 'App Structure', 'Page Objects', 'Environment'].includes(e.category));
    const kbText = relevant.length
      ? relevant.map(e => `[${e.category}] ${e.title}: ${e.body}`).join('\n')
      : '(no knowledge base entries yet)';

    // 3. instruction + context
    const instruction =
      'You are a senior QA test analyst for the eAuto insurance platform (Malaysian vehicle insurance/registration). ' +
      'Read the Jira ticket and knowledge base from stdin and produce a thorough manual+automation test plan. ' +
      'Be careful and complete — the goal is to NOT let any bug slip through. ' +
      'Output ONLY valid minified JSON (no markdown fences, no prose) with this exact schema: ' +
      '{"ticket":string,"summary":string,"understanding":string,"scope":string,"outOfScope":string,' +
      '"scenarios":[{"id":string,"title":string,"type":"positive|negative|edge","priority":"high|medium|low",' +
      '"preconditions":string,"steps":[string],"expected":string,"testData":string}],' +
      '"risks":[string],"openQuestions":[string]}. ' +
      'Put any ambiguities or missing info from the ticket into openQuestions so a human can clarify before testing.';

    const context =
      `=== JIRA TICKET ${ticket.key} ===\nSummary: ${ticket.summary}\n\nDescription:\n${ticket.description || '(no description)'}\n\n` +
      `=== KNOWLEDGE BASE ===\n${kbText}\n`;

    const raw = await callClaude(instruction, context, 150000);
    const plan = parseJsonLoose(raw);
    plan.ticket = plan.ticket || ticket.key;
    plan.summary = plan.summary || ticket.summary;
    res.json({ ok: true, plan, ticketUrl: conf.base + '/browse/' + ticket.key });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Persisted plans (draft/approved)
const PLANS_FILE = path.join(DATA_DIR, 'plans.json');
function readPlans() { try { if (fs.existsSync(PLANS_FILE)) return JSON.parse(fs.readFileSync(PLANS_FILE, 'utf8')); } catch {} return { plans: {} }; }
function writePlans(d) { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(PLANS_FILE, JSON.stringify(d, null, 2)); }

app.get('/api/plans', (req, res) => res.json(readPlans()));
app.post('/api/plans', (req, res) => {
  try {
    const { key, plan, status } = req.body || {};
    if (!key) return res.json({ ok: false, error: 'key required' });
    const all = readPlans();
    all.plans[key] = { plan, status: status || 'draft', updatedAt: new Date().toISOString() };
    writePlans(all);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.listen(PORT, () => console.log(`\n🚀 QA Platform → http://localhost:${PORT}\n`));
