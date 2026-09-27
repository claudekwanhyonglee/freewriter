const { test, expect, launch, setOsTheme, tempDir } = require('./fixture');

const CREAM = 'rgb(247, 243, 234)';
const CHARCOAL = 'rgb(30, 30, 30)';

const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const windowBackground = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor());

async function clickThemeButton(page) {
  await page.mouse.move(300, 300, { steps: 5 });
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
}

test('#29 AC1: the controls menu has a theme button that switches between light and dark', async ({ page }) => {
  await setOsTheme(page, 'light');
  await clickThemeButton(page);
  await expect.poll(() => background(page)).toBe(CHARCOAL);
  await clickThemeButton(page);
  await expect.poll(() => background(page)).toBe(CREAM);
});

test('#29 AC1: the switch works from a dark OS too', async ({ page }) => {
  await setOsTheme(page, 'dark');
  await clickThemeButton(page);
  await expect.poll(() => background(page)).toBe(CREAM);
});

test('#29 AC2: with no saved choice, the theme follows the OS', async ({ page }) => {
  await setOsTheme(page, 'dark');
  expect(await background(page)).toBe(CHARCOAL);
  await setOsTheme(page, 'light');
  expect(await background(page)).toBe(CREAM);
});

test('#29 AC3: the chosen theme survives a restart, window background included', async () => {
  const dir = tempDir('fw-');
  const userData = tempDir('fw-');
  const first = await launch({ dir, userData });
  await setOsTheme(first.page, 'light');
  await clickThemeButton(first.page);
  await expect.poll(() => background(first.page)).toBe(CHARCOAL);
  await first.app.close();

  const second = await launch({ dir, userData });
  expect((await windowBackground(second.app)).toLowerCase()).toBe('#1e1e1e');
  expect(await background(second.page)).toBe(CHARCOAL);
  await setOsTheme(second.page, 'light'); // a saved choice overrides the OS
  expect(await background(second.page)).toBe(CHARCOAL);
  await second.app.close();
});

test('#29 AC3: a saved light choice survives a restart under a dark OS', async () => {
  const dir = tempDir('fw-');
  const userData = tempDir('fw-');
  const first = await launch({ dir, userData });
  await setOsTheme(first.page, 'dark');
  await clickThemeButton(first.page);
  await expect.poll(() => background(first.page)).toBe(CREAM);
  await first.app.close();

  const second = await launch({ dir, userData });
  await setOsTheme(second.page, 'dark');
  expect(await background(second.page)).toBe(CREAM);
  expect((await windowBackground(second.app)).toLowerCase()).toBe('#f7f3ea');
  await second.app.close();
});

test('#29 AC4: light is the cream palette and dark the charcoal one', async ({ page }) => {
  await setOsTheme(page, 'light');
  await clickThemeButton(page);
  await expect.poll(() => background(page)).toBe(CHARCOAL);
  await clickThemeButton(page);
  await expect.poll(() => background(page)).toBe(CREAM);
});
