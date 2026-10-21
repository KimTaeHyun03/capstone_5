import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/ui',
  fullyParallel:false,
  workers:1,
  use:{baseURL:'http://127.0.0.1:5178',browserName:'chromium',channel:'msedge',headless:true},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5178 --strictPort',url:'http://127.0.0.1:5178',reuseExistingServer:!process.env.CI},
});
