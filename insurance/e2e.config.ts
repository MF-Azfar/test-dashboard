import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

/**
 * Dedicated Playwright config for the UCD Insurance END-TO-END flow.
 * Kept separate from the batch quote-checker (playwright.config.ts) so the two
 * never collide. The server invokes this via:  --config=e2e.config.ts
 *
 * Video recording is ON (needs ffmpeg — bundled with Playwright) so every run
 * produces a watchable recording. A generous viewport keeps the recording clear.
 */

// Where annotated screenshots + the run report are written. The server points
// this at  public/artifacts/<runId>/  so everything is statically served.
const ARTIFACT_DIR =
  process.env.E2E_ARTIFACT_DIR || path.join(__dirname, 'e2e', 'artifacts', 'local');

const VIEWPORT = { width: 1536, height: 864 };

export default defineConfig({
  testDir: './e2e',
  testMatch: 'insurance-e2e.spec.ts',

  // The whole e2e journey can take a few minutes (real insurer + payment APIs),
  // but never hang forever — 12 min ceiling so a wedged staging fails cleanly.
  timeout: Number(process.env.E2E_TIMEOUT || 720000),
  retries: 0,
  workers: 1,

  reporter: [['list']],

  // Playwright's own trace/video temp files live here (gitignored).
  outputDir: path.join(__dirname, 'e2e', '.pw-results'),

  use: {
    headless: process.env.E2E_HEADLESS === 'true',
    viewport: VIEWPORT,
    navigationTimeout: 60000,
    actionTimeout: 30000,

    // Full video of the run, sized to the viewport.
    video: { mode: 'on', size: VIEWPORT },

    // Trace only kept if something throws — handy for debugging failed runs.
    trace: 'retain-on-failure',

    // slowMo makes the recording easy to follow. Tunable via env.
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO || '300') },
  },

  projects: [
    {
      name: 'insurance-e2e',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
    },
  ],
});
