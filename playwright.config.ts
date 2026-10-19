import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
const installedChrome=process.platform==='win32'&&existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe');
export default defineConfig({testDir:'./tests/browser',outputDir:path.resolve('..','..','work','test-results'),timeout:30000,fullyParallel:false,workers:1,reporter:'list',use:{baseURL:'http://127.0.0.1:3210',browserName:'chromium',channel:installedChrome?'chrome':undefined,headless:true,viewport:{width:1440,height:1050},trace:'retain-on-failure'},webServer:{command:'npm run start',url:'http://127.0.0.1:3210/api/health',reuseExistingServer:!process.env.CI,timeout:30000}});
