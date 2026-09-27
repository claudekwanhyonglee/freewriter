const { test, expect } = require('./fixture');

const ITEMS = ['Table', 'Heading 1', 'Heading 2', 'Heading 3', 'Bullet list', 'Numbered list', 'Checklist', 'Quote', 'Divider', 'Code block'];

const menu = (page) => page.locator('#slash-menu');
const options = (page) => menu(page).getByRole('option');
const editor = (page) => page.locator('#editor');

test('#15 AC1: / at the start of a line opens a menu listing the blocks', async ({ page }) => {
  await expect(menu(page)).toBeHidden();
  await page.keyboard.type('/');
  await expect(menu(page)).toBeVisible();
  await expect(options(page)).toHaveText(ITEMS);
});

test('#15 AC1: / after a space opens the menu too', async ({ page }) => {
  await page.keyboard.type('Some text /');
  await expect(menu(page)).toBeVisible();
  await expect(options(page)).toHaveText(ITEMS);
});

test('#15 AC1: the menu sits next to the caret', async ({ page }) => {
  await page.keyboard.type('Some text /');
  const box = await menu(page).boundingBox();
  const caret = await page.evaluate(() => getSelection().getRangeAt(0).getBoundingClientRect().toJSON());
  expect(Math.abs(box.y - caret.bottom)).toBeLessThan(40);
  expect(Math.abs(box.x - caret.left)).toBeLessThan(200);
});

test('#15 AC2: typing after / filters the list', async ({ page }) => {
  await page.keyboard.type('/ta');
  await expect(options(page)).toHaveText(['Table']);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('hea');
  await expect(options(page)).toHaveText(['Heading 1', 'Heading 2', 'Heading 3']);
});

test('#15 AC2: Enter inserts the highlighted item and removes the /… text', async ({ page }) => {
  await page.keyboard.type('/ta');
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeHidden();
  await expect(editor(page).locator('table')).toHaveCount(1);
  await expect(editor(page)).not.toContainText('/ta');
});

test('#15 AC2: ↑/↓ move the highlight', async ({ page }) => {
  await page.keyboard.type('/');
  await expect(options(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(options(page).nth(2)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(editor(page).locator('h2')).toHaveCount(1);
  await expect(editor(page)).toHaveText('');
  await page.keyboard.type('Title');
  await expect(editor(page).locator('h2')).toHaveText('Title');
});

const inserted = {
  'Table': 'table',
  'Heading 1': 'h1',
  'Heading 2': 'h2',
  'Heading 3': 'h3',
  'Bullet list': 'ul > li:not(.task)',
  'Numbered list': 'ol > li',
  'Checklist': 'ul > li.task',
  'Quote': 'blockquote',
  'Divider': 'hr',
  'Code block': 'pre',
};

for (const [item, selector] of Object.entries(inserted)) {
  test(`#15 AC2: clicking ${item} inserts it and removes the /… text`, async ({ page }) => {
    await page.keyboard.type('Before /');
    await options(page).getByText(item, { exact: true }).click();
    await expect(menu(page)).toBeHidden();
    await expect(editor(page).locator(selector)).toHaveCount(1);
    await expect(editor(page)).not.toContainText('/');
    await expect(editor(page)).toContainText('Before');
    await expect(editor(page)).toBeFocused();
  });
}

test('#15 AC3: Esc closes the menu and leaves the typed text', async ({ page }) => {
  await page.keyboard.type('/ta');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(editor(page)).toHaveText('/ta');
  await page.keyboard.type('b');
  await expect(menu(page)).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(editor(page).locator('table')).toHaveCount(0);
});

test('#15 AC3: typing a space closes the menu and leaves the typed text', async ({ page }) => {
  await page.keyboard.type('/ta ');
  await expect(menu(page)).toBeHidden();
  await expect(editor(page)).toHaveText('/ta');
  await expect(editor(page).locator('p')).toHaveJSProperty('textContent', '/ta ');
});

test('#15 AC3: a / inside a word does not open the menu', async ({ page }) => {
  await page.keyboard.type('and/');
  await expect(menu(page)).toBeHidden();
  await page.keyboard.type('or');
  await expect(menu(page)).toBeHidden();
  await expect(editor(page)).toHaveText('and/or');
});
