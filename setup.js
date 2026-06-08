/**
 * setup.js — run once after cloning: node setup.js
 * Installs npm dependencies for all three packages and Playwright browsers.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ROOT      = __dirname;
const DIRS      = [ROOT, path.join(ROOT,'insurance'), path.join(ROOT,'estm')];
const LABELS    = ['Platform (server)', 'Insurance checker', 'eSTM bypass'];

function run(cmd, cwd, label) {
  console.log(`\n📦  [${label}] ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

console.log('╔══════════════════════════════════════╗');
console.log('║   eAuto QA Platform — First-time     ║');
console.log('║   Setup                               ║');
console.log('╚══════════════════════════════════════╝\n');

// 1. npm install for each package
DIRS.forEach((dir, i) => {
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    console.log(`⚠️  No package.json in ${dir}, skipping.`);
    return;
  }
  run('npm install', dir, LABELS[i]);
});

// 2. Install Playwright browsers for both script folders
[
  [path.join(ROOT,'insurance'), 'Insurance'],
  [path.join(ROOT,'estm'),      'eSTM'],
].forEach(([dir, label]) => {
  const cli = path.join(dir, 'node_modules', '@playwright', 'test', 'cli.js');
  if (fs.existsSync(cli)) {
    run(`"${process.execPath}" "${cli}" install chromium`, dir, `${label} — install Chromium`);
  }
});

console.log('\n✅  All done! Run  node start.js  to launch the platform.\n');
