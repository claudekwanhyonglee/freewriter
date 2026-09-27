const { test: base, _electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function launch({ dir, userData }) {
  const app = await _electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, FREEWRITER_DIR: dir },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('#editor');
  return { app, page };
}

const test = base.extend({
  dir: async ({}, use) => use(tempDir('fw-sessions-')),
  userData: async ({}, use) => use(tempDir('fw-userdata-')),
  launched: async ({ dir, userData }, use) => {
    const launched = await launch({ dir, userData });
    await use(launched);
    await launched.app.close();
  },
  app: async ({ launched }, use) => use(launched.app),
  page: async ({ launched }, use) => use(launched.page),
});

module.exports = { test, expect: base.expect, launch, mod, tempDir };
