import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  
  // No global timeout - each vehicle has its own timeouts
  timeout: 0,
  
  // No retries for this kind of automation
  retries: 0,
  
  // Run sequentially (not parallel) since we use one browser session
  workers: 1,
  
  // Reporter
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],

  use: {
    // Browser visibility — controlled by the platform via INS_HEADLESS env var.
    // INS_HEADLESS=true  -> no browser window (faster, less resources)
    // INS_HEADLESS=false -> visible browser window (default)
    headless: process.env.INS_HEADLESS === 'true',

    // Viewport
    viewport: { width: 1920, height: 1080 },

    // Timeouts
    navigationTimeout: 60000,
    actionTimeout: 30000,

    // Screenshots on failure
    screenshot: 'only-on-failure',

    // Trace on failure
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'insurance-checker',
      use: {
        ...devices['Desktop Chrome'],
        headless: process.env.INS_HEADLESS === 'true',
      },
    },
  ],
});
