const fs = require('fs');
const { test, expect, launchWithSession } = require('./fixture');

const editor = (page) => page.locator('#editor');
const table = (page) => editor(page).locator('table');
const rows = (page) => table(page).locator('tr');
const cell = (page, row, col) => rows(page).nth(row).locator('th, td').nth(col);
const handle = (page, name) => page.getByRole('button', { name, exact: true });

/** The table's cells as text, row by row. */
const cellTexts = (page) => table(page).evaluate((t) => [...t.rows].map((r) => [...r.cells].map((c) => c.textContent)));

const THREE_BY_THREE = '| A | B | C |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |';

async function insertTable(page) {
  await page.keyboard.type('/table');
  await page.keyboard.press('Enter');
}

test('#16 AC1: inserting a table from the slash menu gives a 2×2 grid with the caret in the first cell', async ({ page }) => {
  await insertTable(page);
  expect(await cellTexts(page)).toEqual([['', ''], ['', '']]);
  await expect(rows(page).nth(0).locator('th')).toHaveCount(2);
  await page.keyboard.type('x');
  expect(await cellTexts(page)).toEqual([['x', ''], ['', '']]);
});

test('#16 AC2: hovering the table shows + handles at its right edge and bottom', async ({ page }) => {
  await insertTable(page);
  await expect(handle(page, 'Add column')).toBeHidden();
  await expect(handle(page, 'Add row')).toBeHidden();

  await cell(page, 1, 0).hover();
  await expect(handle(page, 'Add column')).toBeVisible();
  await expect(handle(page, 'Add row')).toBeVisible();
  const box = await table(page).boundingBox();
  const addColumn = await handle(page, 'Add column').boundingBox();
  const addRow = await handle(page, 'Add row').boundingBox();
  expect(addColumn.x).toBeGreaterThanOrEqual(box.x + box.width - 4);
  expect(addColumn.x).toBeLessThan(box.x + box.width + 30);
  expect(addRow.y).toBeGreaterThanOrEqual(box.y + box.height - 4);
  expect(addRow.y).toBeLessThan(box.y + box.height + 30);

  await page.mouse.move(5, 5);
  await expect(handle(page, 'Add column')).toBeHidden();
});

test('#16 AC2: clicking the + handles adds a column and a row', async ({ page }) => {
  await insertTable(page);
  await page.keyboard.type('a');
  await cell(page, 1, 1).hover();
  await handle(page, 'Add column').click();
  expect(await cellTexts(page)).toEqual([['a', '', ''], ['', '', '']]);
  await handle(page, 'Add row').click();
  expect(await cellTexts(page)).toEqual([['a', '', ''], ['', '', ''], ['', '', '']]);
  await expect(rows(page).nth(0).locator('th')).toHaveCount(3);
});

test('#16 AC3: hovering a row or column shows × handles that remove it', async () => {
  const { app, page } = await launchWithSession(THREE_BY_THREE);
  await expect(handle(page, 'Remove row')).toBeHidden();

  await cell(page, 1, 1).hover();
  await expect(handle(page, 'Remove row')).toBeVisible();
  await expect(handle(page, 'Remove column')).toBeVisible();
  const rowBox = await rows(page).nth(1).boundingBox();
  const removeRow = await handle(page, 'Remove row').boundingBox();
  expect(removeRow.y + removeRow.height / 2).toBeGreaterThan(rowBox.y);
  expect(removeRow.y + removeRow.height / 2).toBeLessThan(rowBox.y + rowBox.height);

  await handle(page, 'Remove row').click();
  expect(await cellTexts(page)).toEqual([['A', 'B', 'C'], ['4', '5', '6']]);

  await cell(page, 1, 1).hover();
  const colBox = await cell(page, 0, 1).boundingBox();
  const removeColumn = await handle(page, 'Remove column').boundingBox();
  expect(removeColumn.x + removeColumn.width / 2).toBeGreaterThan(colBox.x);
  expect(removeColumn.x + removeColumn.width / 2).toBeLessThan(colBox.x + colBox.width);
  await handle(page, 'Remove column').click();
  expect(await cellTexts(page)).toEqual([['A', 'C'], ['4', '6']]);
  await app.close();
});

test('#16 AC3: removing the header row makes the next row the header', async () => {
  const { app, page } = await launchWithSession(THREE_BY_THREE);
  await cell(page, 0, 0).hover();
  await handle(page, 'Remove row').click();
  expect(await cellTexts(page)).toEqual([['1', '2', '3'], ['4', '5', '6']]);
  await expect(rows(page).nth(0).locator('th')).toHaveCount(3);
  await app.close();
});

test('#16 AC3: removing the last body row or column removes the table', async () => {
  const { app, page } = await launchWithSession('Before\n\n| A |\n| - |\n| 1 |\n\nAfter');
  await cell(page, 1, 0).hover();
  await handle(page, 'Remove row').click();
  await expect(table(page)).toHaveCount(0);
  await expect(editor(page)).toContainText('Before');
  await expect(editor(page)).toContainText('After');
  await app.close();
});

test('#16 AC4: Tab / Shift+Tab move between cells; Tab in the last cell adds a row', async ({ page }) => {
  await insertTable(page);
  await page.keyboard.type('a');
  await page.keyboard.press('Tab');
  await page.keyboard.type('b');
  await page.keyboard.press('Tab');
  await page.keyboard.type('c');
  await page.keyboard.press('Shift+Tab'); // moving into a cell selects its text, as in a spreadsheet
  await page.keyboard.type('B');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.type('d');
  expect(await cellTexts(page)).toEqual([['a', 'B'], ['c', 'd']]);

  await page.keyboard.press('Tab'); // in the last cell
  await page.keyboard.type('e');
  expect(await cellTexts(page)).toEqual([['a', 'B'], ['c', 'd'], ['e', '']]);
  await expect(editor(page)).toBeFocused();
});

test('#16 AC5: a table is saved as a GFM table and reopens identically', async ({ page, dir }) => {
  await insertTable(page);
  for (const text of ['Name', 'Age', 'Ann', '31']) {
    await page.keyboard.type(text);
    await page.keyboard.press('Tab');
  }
  await page.keyboard.type('Bob');
  const expected = '| Name | Age |\n| ---- | --- |\n| Ann  | 31  |\n| Bob  |     |';
  const file = () => `${dir}/${fs.readdirSync(dir)[0]}`;
  await expect.poll(() => fs.readdirSync(dir).length && fs.readFileSync(file(), 'utf8')).toBe(expected);
  const cells = await cellTexts(page);

  const reopened = await launchWithSession(expected);
  expect(await cellTexts(reopened.page)).toEqual(cells);
  await reopened.app.close();
  expect(fs.readFileSync(reopened.file, 'utf8')).toBe(expected);
});
