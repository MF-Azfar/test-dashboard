const http    = require('http');
const { spawn } = require('child_process');
const path    = require('path');
const net     = require('net');

const PORT    = 3000;
const SERVER  = path.join(__dirname, 'server.js');
const NODE    = process.execPath;   // same node.exe that is running this script

// ── Kill anything already on port 3000 ───────────────────────────────────────
function killPort() {
  return new Promise(resolve => {
    const finder = require('child_process').spawn(
      'cmd', ['/c', `for /f "tokens=5" %p in ('netstat -aon ^| findstr ":${PORT}.*LISTENING"') do taskkill /F /PID %p`],
      { shell: false, stdio: 'ignore' }
    );
    finder.on('close', () => setTimeout(resolve, 500));
  });
}

// ── Wait until the server responds on /api/status ────────────────────────────
function waitForServer(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start    = Date.now();
    const interval = setInterval(() => {
      http.get(`http://localhost:${PORT}/api/status`, res => {
        clearInterval(interval);
        resolve();
      }).on('error', () => {
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          reject(new Error('Server did not start within 20 seconds'));
        }
      });
    }, 500);
  });
}

// ── Open browser ─────────────────────────────────────────────────────────────
function openBrowser(url) {
  spawn('cmd', ['/c', 'start', url], { shell: false, stdio: 'ignore', detached: true }).unref();
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('🔄  Stopping any existing server on port', PORT, '...');
  await killPort();

  console.log('🚀  Starting QA Platform server...');
  const server = spawn(NODE, [SERVER], {
    cwd:        __dirname,
    detached:   false,
    stdio:      'inherit',   // server logs print directly in this window
    windowsHide: false,
  });

  server.on('error', err => {
    console.error('❌  Failed to start server:', err.message);
    process.exit(1);
  });

  server.on('exit', (code, signal) => {
    console.log(`\n⚠️  Server stopped (code=${code} signal=${signal})`);
    process.exit(code || 0);
  });

  console.log('⏳  Waiting for server to be ready...');
  try {
    await waitForServer();
    console.log(`✅  Server ready at http://localhost:${PORT}`);
    console.log('🌐  Opening browser...\n');
    openBrowser(`http://localhost:${PORT}`);
    console.log('    Keep this window open — closing it stops the server.\n');
  } catch (err) {
    console.error('❌ ', err.message);
    console.error('    Check the output above for errors.');
  }
})();
