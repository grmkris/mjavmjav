import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const stateDirectory = process.env.SITE_URL ? null : mkdtempSync(join(tmpdir(), 'mjav-test-'));

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  workers: 1,
  use: {
    baseURL: process.env.SITE_URL || 'http://127.0.0.1:8791',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: process.env.SITE_URL ? undefined : {
    command: `bun run dev -- --port 8791 --ip 127.0.0.1 --host 127.0.0.1:8791 --upstream-protocol http --persist-to ${stateDirectory}`,
    url: 'http://127.0.0.1:8791',
    reuseExistingServer: false,
  },
});
