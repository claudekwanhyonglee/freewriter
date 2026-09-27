const fs = require('fs');
const path = require('path');
const { test, expect, launch, launchWithSession, tempDir } = require('./fixture');

// #24 AC1: alphabetical, Atkinson Hyperlegible first and the default.
const FONTS = ['Atkinson Hyperlegible', 'EB Garamond', 'iA Writer Mono', 'Inter', 'Literata', 'Source Serif 4'];
const DEFAULT_FONT = 'Atkinson Hyperlegible';

const fontButton = (page) => page.getByRole('button', { name: 'Font', exact: true });
const fontList = (page) => page.locator('#font-list');
const fontOption = (page, name) => fontList(page).getByRole('option', { name, exact: true });
const primaryFont = (locator) => locator.evaluate((el) => getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''));

async function openFontList(page) {
  await page.mouse.move(300, 300, { steps: 5 });
  await fontButton(page).click();
  await expect(fontList(page)).toBeVisible();
}

test('#13 AC1: an "Aa" button in the controls lists the six fonts, each in its own font', async ({ page }) => {
  await page.mouse.move(300, 300, { steps: 5 });
  await expect(page.locator('#controls').getByRole('button', { name: 'Font', exact: true })).toHaveText('Aa');
  await expect(fontList(page)).toBeHidden();
  await fontButton(page).click();
  await expect(fontList(page).getByRole('option')).toHaveText(FONTS);
  for (const name of FONTS) expect(await primaryFont(fontOption(page, name))).toBe(name);
});

test('#13 AC2: clicking a font applies it to all prose, keeps code monospace, and closes the list', async () => {
  const { app, page } = await launchWithSession('# Title\n\nSome `code` here\n\n- item\n\n| A |\n| - |\n| 1 |\n\n```\nblock\n```');
  await openFontList(page);
  await fontOption(page, 'Inter').click();
  await expect(fontList(page)).toBeHidden();

  for (const selector of ['#editor', '#editor h1', '#editor p', '#editor li', '#editor td', '#editor th']) {
    expect(await primaryFont(page.locator(selector).first())).toBe('Inter');
  }
  for (const selector of ['#editor p code', '#editor pre']) {
    expect(await primaryFont(page.locator(selector).first())).not.toBe('Inter');
    expect(await page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/monospace/);
  }
  await expect(page.locator('#editor')).toBeFocused();
  await app.close();
});

test('#13 AC2: Esc closes the list without changing the font', async ({ page }) => {
  await openFontList(page);
  await fontOption(page, 'Inter').hover();
  await page.keyboard.press('Escape');
  await expect(fontList(page)).toBeHidden();
  expect(await primaryFont(page.locator('#editor'))).toBe(DEFAULT_FONT);
});

test('#13 AC2: clicking outside closes the list without changing the font', async ({ page }) => {
  await openFontList(page);
  await page.mouse.click(200, 400);
  await expect(fontList(page)).toBeHidden();
  expect(await primaryFont(page.locator('#editor'))).toBe(DEFAULT_FONT);
});

test('#13 AC3 / #24 AC2: the font is Atkinson Hyperlegible by default and the chosen font persists across restarts', async () => {
  const dir = tempDir('fw-');
  const userData = tempDir('fw-');
  const first = await launch({ dir, userData });
  expect(await primaryFont(first.page.locator('#editor'))).toBe(DEFAULT_FONT);
  await openFontList(first.page);
  await fontOption(first.page, 'EB Garamond').click();
  await first.app.close();

  const second = await launch({ dir, userData });
  expect(await primaryFont(second.page.locator('#editor'))).toBe('EB Garamond');
  await second.app.close();
  expect(fs.readdirSync(dir)).toEqual([]); // settings don't live in the sessions folder
});

test('#13 AC4: all six fonts are bundled with their licences and load without the network', async ({ page }) => {
  await page.context().setOffline(true);
  const loaded = await page.evaluate(async (fonts) => {
    const result = {};
    for (const name of fonts) {
      const faces = await document.fonts.load(`16px "${name}"`, 'Hello');
      result[name] = faces.length > 0 && faces.every((face) => face.status === 'loaded');
    }
    return result;
  }, FONTS);
  expect(loaded).toEqual(Object.fromEntries(FONTS.map((name) => [name, true])));

  const fontsDir = path.join(__dirname, '..', 'src', 'fonts');
  for (const name of FONTS) expect(fs.existsSync(path.join(fontsDir, `${name.replace(/ /g, '')}-LICENSE.txt`))).toBe(true);
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'fonts.css'), 'utf8');
  expect(css).not.toMatch(/url\(\s*['"]?(https?:)?\/\//); // nothing fetched from the web
});

test('#24 AC1: the font list is alphabetical', async ({ page }) => {
  await openFontList(page);
  await expect(fontList(page).getByRole('option')).toHaveText([
    'Atkinson Hyperlegible', 'EB Garamond', 'iA Writer Mono', 'Inter', 'Literata', 'Source Serif 4',
  ]);
});

test('#24 AC2: with no saved choice the font is Atkinson Hyperlegible', async ({ page }) => {
  expect(await primaryFont(page.locator('#editor'))).toBe('Atkinson Hyperlegible');
});

test('#24 AC3: a saved Literata still applies after a restart', async () => {
  const dir = tempDir('fw-');
  const userData = tempDir('fw-');
  const first = await launch({ dir, userData });
  await openFontList(first.page);
  await fontOption(first.page, 'Literata').click();
  expect(await primaryFont(first.page.locator('#editor'))).toBe('Literata');
  await first.app.close();

  const second = await launch({ dir, userData });
  expect(await primaryFont(second.page.locator('#editor'))).toBe('Literata');
  await second.app.close();
});
