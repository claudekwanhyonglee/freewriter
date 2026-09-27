const fs = require('fs');
const path = require('path');
const { test, expect, launch, mod, seed, tempDir } = require('./fixture');

const mdFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();

test('#4 AC1: Ctrl/Cmd+O toggles the sidebar, which is hidden on launch', async ({ page }) => {
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).toBeHidden();
  await page.keyboard.press(`${mod}+o`);
  await expect(sidebar).toBeVisible();
  await page.keyboard.press(`${mod}+o`);
  await expect(sidebar).toBeHidden();
});

test('#4 AC2: sidebar lists every session newest first with date/time and first line', async () => {
  const dir = tempDir('fw-');
  seed(dir, {
    '2025-01-02 09-05-00.md': 'Oldest thoughts\nmore',
    '2026-03-04 18-30-15.md': '\n\n  Newest morning pages  \nsecond line',
    '2025-12-31 23-59-59.md': 'Year end',
  });
  const { app, page } = await launch({ dir, userData: tempDir('fw-') });
  await page.keyboard.press(`${mod}+o`);

  const items = page.locator('#sidebar li');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('2026-03-04 18:30');
  await expect(items.nth(0)).toContainText('Newest morning pages');
  await expect(items.nth(1)).toContainText('2025-12-31 23:59');
  await expect(items.nth(1)).toContainText('Year end');
  await expect(items.nth(2)).toContainText('2025-01-02 09:05');
  await expect(items.nth(2)).toContainText('Oldest thoughts');
  await expect(items.nth(2)).not.toContainText('more');
  await app.close();
});

test('#4 AC2: the current session appears in the list once it has text', async ({ page }) => {
  await page.keyboard.type('Just now');
  await page.keyboard.press(`${mod}+o`);
  await expect(page.locator('#sidebar li')).toHaveCount(1);
  await expect(page.locator('#sidebar li').first()).toContainText('Just now');
});

test('#4 AC3: clicking a session loads it and further edits save to the same file', async () => {
  const dir = tempDir('fw-');
  seed(dir, { '2025-01-02 09-05-00.md': 'An old session' });
  const { app, page } = await launch({ dir, userData: tempDir('fw-') });

  await page.keyboard.press(`${mod}+o`);
  await page.locator('#sidebar li').first().click();
  await expect(page.locator('#editor')).toHaveText('An old session');
  await expect(page.locator('#editor')).toBeFocused();

  await page.keyboard.press('End');
  await page.keyboard.type(', continued');
  await app.close();

  expect(mdFiles(dir)).toEqual(['2025-01-02 09-05-00.md']);
  expect(fs.readFileSync(path.join(dir, '2025-01-02 09-05-00.md'), 'utf8')).toBe('An old session, continued');
});

test('#4 AC4: Ctrl/Cmd+N starts a blank session and leaves the previous file intact', async () => {
  const dir = tempDir('fw-');
  const { app, page } = await launch({ dir, userData: tempDir('fw-') });
  await page.keyboard.type('First session');
  await page.keyboard.press(`${mod}+n`);
  await expect(page.locator('#editor')).toHaveText('');
  await expect(page.locator('#editor')).toBeFocused();

  const [first] = mdFiles(dir);
  expect(fs.readFileSync(path.join(dir, first), 'utf8')).toBe('First session');

  await page.keyboard.type('Second session');
  await app.close();

  const files = mdFiles(dir);
  expect(files).toHaveLength(2);
  expect(fs.readFileSync(path.join(dir, first), 'utf8')).toBe('First session');
  const second = files.find((f) => f !== first);
  expect(fs.readFileSync(path.join(dir, second), 'utf8')).toBe('Second session');
});

// --- #12 Delete sessions ---------------------------------------------------------

const SESSIONS = {
  '2025-01-01 08-00-00.md': 'Oldest',
  '2025-01-02 08-00-00.md': 'Middle',
  '2025-01-03 08-00-00.md': 'Newest',
};

/**
 * Stands in for the OS trash, which CI runners may not have: the app still calls shell.trashItem,
 * and the file is moved to `trash`.
 */
async function fakeOsTrash(app, trash) {
  await app.evaluate(({ shell }, trash) => {
    const fs = process.mainModule.require('fs');
    const path = process.mainModule.require('path');
    shell.trashItem = async (file) => fs.renameSync(file, path.join(trash, path.basename(file)));
  }, trash);
}

async function launchWithSessions() {
  const dir = tempDir('fw-');
  const trash = tempDir('fw-trash-');
  seed(dir, SESSIONS);
  const { app, page } = await launch({ dir, userData: tempDir('fw-') });
  await fakeOsTrash(app, trash);
  await page.keyboard.press(`${mod}+o`);
  return { app, page, dir, trash };
}

const row = (page, text) => page.locator('#sidebar li').filter({ hasText: text });
const trashButton = (page, text) => row(page, text).getByRole('button', { name: 'Move to Trash' });

test('#12 AC1: hovering a session row reveals its trash button', async () => {
  const { app, page } = await launchWithSessions();
  await page.mouse.move(5, 300); // away from the sidebar on the right
  await expect(trashButton(page, 'Middle')).toBeHidden();
  await row(page, 'Middle').hover();
  await expect(trashButton(page, 'Middle')).toBeVisible();
  await expect(trashButton(page, 'Newest')).toBeHidden();
  await app.close();
});

test('#12 AC2: clicking it moves the file to the trash without asking and removes the row', async () => {
  const { app, page, dir, trash } = await launchWithSessions();
  const dialogs = [];
  page.on('dialog', (dialog) => dialogs.push(dialog));
  await row(page, 'Middle').hover();
  await trashButton(page, 'Middle').click();

  await expect(row(page, 'Middle')).toHaveCount(0);
  await expect(page.locator('#sidebar li')).toHaveCount(2);
  expect(fs.readdirSync(trash)).toEqual(['2025-01-02 08-00-00.md']);
  expect(fs.readFileSync(path.join(trash, '2025-01-02 08-00-00.md'), 'utf8')).toBe('Middle');
  expect(dialogs).toEqual([]);
  expect(app.windows()).toHaveLength(1);
  await app.close();
  expect(mdFiles(dir)).not.toContain('2025-01-02 08-00-00.md');
});

test('#12 AC3: deleting the open session switches to a new blank session', async () => {
  const { app, page, dir, trash } = await launchWithSessions();
  await row(page, 'Middle').click();
  await page.keyboard.type(' and more');
  // Since #31 the sidebar stays open; closing and reopening it refreshes the list.
  await page.keyboard.press(`${mod}+o`);
  await page.keyboard.press(`${mod}+o`);
  await row(page, 'Middle and more').hover();
  await trashButton(page, 'Middle and more').click();

  await expect(page.locator('#editor')).toHaveText('');
  await expect(page.locator('#editor')).toBeFocused();
  expect(fs.readFileSync(path.join(trash, '2025-01-02 08-00-00.md'), 'utf8')).toBe('Middle and more'); // nothing lost
  await page.keyboard.type('Fresh start');
  await app.close();

  const files = mdFiles(dir);
  expect(files).toHaveLength(3);
  expect(files).not.toContain('2025-01-02 08-00-00.md'); // not written back after trashing
  const fresh = files.find((f) => !(f in SESSIONS));
  expect(fs.readFileSync(path.join(dir, fresh), 'utf8')).toBe('Fresh start');
});

// --- #31 Sidebar browsing ------------------------------------------------------------

const controls = (page) => page.locator('#controls');
const sidebar = (page) => page.locator('#sidebar');

test('#31 AC1: with the sidebar open, the menu shows without mouse movement, and stays through idle and typing', async ({ page }) => {
  await page.keyboard.press(`${mod}+o`);
  await expect(controls(page)).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(controls(page)).toBeVisible();
  await page.keyboard.type('typing away');
  await page.waitForTimeout(500);
  await expect(controls(page)).toBeVisible();
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('controls')).opacity))).toBeGreaterThanOrEqual(0.6);
});

test('#31 AC2: after the sidebar closes, the menu fades after mouse inactivity as before', async ({ page }) => {
  await page.keyboard.press(`${mod}+o`);
  await page.mouse.move(300, 300, { steps: 5 });
  await page.waitForTimeout(2500); // the fade timer has run out while the sidebar held the menu
  await page.keyboard.press(`${mod}+o`);
  await expect(sidebar(page)).toBeHidden();
  await expect(controls(page)).toBeHidden({ timeout: 1500 });

  await page.mouse.move(320, 320, { steps: 5 });
  await expect(controls(page)).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(controls(page)).toBeVisible();
  await expect(controls(page)).toBeHidden({ timeout: 1500 });
});

test('#31 AC3: clicking a session loads it and the sidebar stays open', async () => {
  const { app, page } = await launchWithSessions();
  await row(page, 'Middle').click();
  await expect(page.locator('#editor')).toHaveText('Middle');
  await expect(sidebar(page)).toBeVisible();
  await row(page, 'Oldest').click();
  await expect(page.locator('#editor')).toHaveText('Oldest');
  await expect(sidebar(page)).toBeVisible();
  await app.close();
});

test('#31 AC4: clicking the writing area closes the sidebar', async () => {
  const { app, page } = await launchWithSessions();
  await row(page, 'Middle').click();
  await page.mouse.click(100, 400);
  await expect(sidebar(page)).toBeHidden();
  await expect(page.locator('#editor')).toBeFocused();
  await app.close();
});

test('#31 AC5: the sessions button and "+" still close the sidebar', async ({ page }) => {
  const button = (name) => page.getByRole('button', { name, exact: true });
  await page.keyboard.press(`${mod}+o`);
  await button('Sessions').click();
  await expect(sidebar(page)).toBeHidden();

  await page.keyboard.press(`${mod}+o`);
  await expect(sidebar(page)).toBeVisible();
  await button('New session').click();
  await expect(sidebar(page)).toBeHidden();
});

test('#12 AC4: other session files are left untouched', async () => {
  const { app, page, dir } = await launchWithSessions();
  const before = Object.fromEntries(['2025-01-01 08-00-00.md', '2025-01-03 08-00-00.md'].map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]));
  await row(page, 'Middle').hover();
  await trashButton(page, 'Middle').click();
  await expect(row(page, 'Middle')).toHaveCount(0);
  await app.close();

  for (const [name, mtime] of Object.entries(before)) {
    expect(fs.readFileSync(path.join(dir, name), 'utf8')).toBe(SESSIONS[name]);
    expect(fs.statSync(path.join(dir, name)).mtimeMs).toBe(mtime);
  }
});
