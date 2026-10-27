import { defineConfig, devices } from '@playwright/test';

// Uses the Microsoft Edge already installed on this machine (no browser download).
// SwiftShader keeps WebGL2 (the map) working in headless mode.
const edge = { channel: 'msedge', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } };

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  outputDir: 'test-results',
  use: { baseURL: 'http://localhost:4173', ...edge },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], ...edge } },
  ],
  // Needs `npm run build` first; the preview server serves dist/.
  webServer: { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
});
