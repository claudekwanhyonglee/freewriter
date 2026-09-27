const { test: base, expect, _electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function launch({ dir, userData, env = {} }) {
  const fullEnv = { ...process.env, FREEWRITER_DIR: dir, ...env };
  if (dir === undefined) delete fullEnv.FREEWRITER_DIR;
  const app = await _electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`],
    env: fullEnv,
  });
  const page = await app.firstWindow();
  await page.waitForSelector('#editor');
  return { app, page };
}

function seed(dir, sessions) {
  for (const [name, text] of Object.entries(sessions)) fs.writeFileSync(path.join(dir, name), text);
}

/** Launches the app on a sessions folder holding just `text`, and opens that session. */
async function launchWithSession(text, { dir = tempDir('fw-'), userData = tempDir('fw-') } = {}) {
  const name = '2025-01-02 09-05-00.md';
  seed(dir, { [name]: text });
  const { app, page } = await launch({ dir, userData });
  await page.keyboard.press(`${mod}+o`);
  await page.locator('#sidebar li').first().click();
  await expect(page.locator('#sidebar')).toBeHidden();
  return { app, page, dir, file: path.join(dir, name) };
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

module.exports = { test, expect, launch, launchWithSession, mod, seed, tempDir };
