const fs = require('fs');
const path = require('path');
const { test, expect, launch, tempDir } = require('./fixture');

const SESSION_NAME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})\.md$/;

const mdFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : []);

function localTimeOf(fileName) {
  const [, y, mo, d, h, mi, s] = fileName.match(SESSION_NAME).map(Number);
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

test('#3 AC1: first non-whitespace character creates a file named with local creation time', async ({ page, dir }) => {
  await page.keyboard.type('  \n ');
  await page.waitForTimeout(700);
  expect(mdFiles(dir)).toEqual([]);

  const before = Math.floor(Date.now() / 1000) * 1000;
  await page.keyboard.type('x');
  await expect.poll(() => mdFiles(dir).length).toBe(1);
  const after = Date.now();

  const [name] = mdFiles(dir);
  expect(name).toMatch(SESSION_NAME);
  expect(localTimeOf(name)).toBeGreaterThanOrEqual(before);
  expect(localTimeOf(name)).toBeLessThanOrEqual(after);
});

// Since #14 the file holds the editor's content as markdown: Enter starts a new paragraph.
test('#3 AC2: file holds exactly the editor text within 1 s of the last keystroke', async ({ page, dir }) => {
  await page.keyboard.type('First line\nwith ünïcode ✓');
  const text = 'First line\n\nwith ünïcode ✓';
  await expect.poll(() => mdFiles(dir).length).toBe(1);
  const file = path.join(dir, mdFiles(dir)[0]);
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 1000 }).toBe(text);

  await page.keyboard.press('Backspace');
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 1000 }).toBe(text.slice(0, -1));
});

test('#3 AC2: text typed right before closing the app is saved', async () => {
  const dir = tempDir('fw-');
  const { app, page } = await launch({ dir, userData: tempDir('fw-') });
  await page.keyboard.type('written just before quitting');
  await app.close();

  const files = mdFiles(dir);
  expect(files).toHaveLength(1);
  expect(fs.readFileSync(path.join(dir, files[0]), 'utf8')).toBe('written just before quitting');
});

test('#3 AC3: a blank or whitespace-only session creates no file', async () => {
  const dir = tempDir('fw-');
  const blank = await launch({ dir, userData: tempDir('fw-') });
  await blank.app.close();

  const whitespace = await launch({ dir, userData: tempDir('fw-') });
  await whitespace.page.keyboard.type('   \n\t  \n');
  await whitespace.page.waitForTimeout(700);
  await whitespace.app.close();

  expect(mdFiles(dir)).toEqual([]);
});

test('#3 AC4: FREEWRITER_DIR is used and created if missing', async () => {
  const dir = path.join(tempDir('fw-'), 'does', 'not', 'exist');
  const { app, page } = await launch({ dir, userData: tempDir('fw-') });
  await page.keyboard.type('hello');
  await expect.poll(() => mdFiles(dir).length).toBe(1);
  await app.close();
});

test('#3 AC4: without FREEWRITER_DIR, sessions go to ~/Documents/Freewriter', async () => {
  const home = tempDir('fw-home-'); // isolates Documents on Linux; elsewhere we clean up after ourselves
  const { app, page } = await launch({ dir: undefined, userData: tempDir('fw-'), env: { HOME: home } });
  const expectedDir = path.join(await app.evaluate(({ app }) => app.getPath('documents')), 'Freewriter');
  const before = new Set(mdFiles(expectedDir));

  await page.keyboard.type('default location');
  await expect.poll(() => mdFiles(expectedDir).filter((f) => !before.has(f)).length).toBe(1);
  await app.close();

  for (const f of mdFiles(expectedDir).filter((f) => !before.has(f))) fs.unlinkSync(path.join(expectedDir, f));
});
