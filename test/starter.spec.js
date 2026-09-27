const fs = require('fs');
const path = require('path');
const { test, expect } = require('./fixture');

const editor = (page) => page.locator('#editor');
const mdFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : []);

/** The placeholder drawn in the empty editor, or null when there is none. */
const placeholder = (page) => page.evaluate(() => {
  const line = document.querySelector('#editor > p');
  const style = line && getComputedStyle(line, '::before');
  return style && style.content !== 'none' ? { text: JSON.parse(style.content), opacity: parseFloat(style.opacity), color: style.color } : null;
});

test('#11 AC1: an empty editor shows a greyed-out "Today I ..." placeholder', async ({ page }) => {
  const shown = await placeholder(page);
  expect(shown.text).toBe('Today I ...');
  const text = await editor(page).evaluate((e) => getComputedStyle(e).color);
  expect(shown.opacity < 1 || shown.color !== text).toBe(true);
  expect(await editor(page).evaluate((e) => e.textContent)).toBe(''); // drawn, not written
});

test('#11 AC1: the placeholder disappears as soon as there is any text', async ({ page }) => {
  await page.keyboard.type('x');
  expect(await placeholder(page)).toBeNull();
  await page.keyboard.press('Backspace');
  expect((await placeholder(page)).text).toBe('Today I ...');
  await page.keyboard.type(' ');
  expect(await placeholder(page)).toBeNull();
});

test('#11 AC2: Tab in an empty editor inserts "Today I " with the caret at the end', async ({ page }) => {
  await page.keyboard.press('Tab');
  await expect(editor(page)).toBeFocused();
  expect(await editor(page).evaluate((e) => e.textContent)).toBe('Today I ');
  await page.keyboard.type('walked');
  await expect(editor(page)).toHaveText('Today I walked');
});

test('#11 AC3: the inserted text starts the session like typing would', async ({ page, dir }) => {
  await page.keyboard.press('Tab');
  await expect.poll(() => mdFiles(dir).length).toBe(1);
  await page.keyboard.type('slept in');
  const file = path.join(dir, mdFiles(dir)[0]);
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('Today I slept in');
});

test('#11 AC4: Tab in a non-empty editor inserts nothing and keeps focus', async ({ page }) => {
  await page.keyboard.type('Hello');
  await page.mouse.move(300, 300, { steps: 5 }); // the controls are shown, so Tab has somewhere else to go
  await expect(page.locator('#controls')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('!');
  await expect(editor(page)).toHaveText('Hello!');
});

test('#11 AC4: Tab in a list indents the item', async ({ page }) => {
  await page.keyboard.type('- one\ntwo');
  await page.keyboard.press('Tab');
  await expect(editor(page).locator('ul ul > li')).toHaveText('two');
  await expect(editor(page)).not.toContainText('Today I');
});

test('#11 AC4: Tab in a table moves to the next cell', async ({ page }) => {
  await page.keyboard.type('/table');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('b');
  expect(await editor(page).locator('th').allTextContents()).toEqual(['', 'b']);
  await expect(editor(page)).not.toContainText('Today I');
});
