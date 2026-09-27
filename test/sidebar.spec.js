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
