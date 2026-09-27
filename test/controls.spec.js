const fs = require('fs');
const { test, expect, launch, launchWithSession, mod, tempDir } = require('./fixture');

const isMac = process.platform === 'darwin';
const shortcutLabel = (key) => (isMac ? `⌘${key}` : `Ctrl+${key}`);

const controls = (page) => page.locator('#controls');
const button = (page, name) => page.getByRole('button', { name, exact: true });
const fontSize = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('editor')).fontSize));
const isFullScreen = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());

test('#5 AC1: moving the mouse reveals a faint row of buttons in a corner', async ({ page }) => {
  await expect(controls(page)).toBeHidden();
  await page.mouse.move(300, 300, { steps: 5 });
  await expect(controls(page)).toBeVisible();

  for (const name of ['Sessions', 'New session', 'Text smaller', 'Text bigger', 'Fullscreen']) {
    await expect(button(page, name)).toBeVisible();
  }
  const { opacity, rect, width } = await page.evaluate(() => {
    const el = document.getElementById('controls');
    return { opacity: parseFloat(getComputedStyle(el).opacity), rect: el.getBoundingClientRect().toJSON(), width: innerWidth };
  });
  expect(opacity).toBeLessThan(1); // "faint"; #9 AC2 raised the floor to 0.6
  expect(rect.top).toBeLessThan(40);
  expect(width - rect.right).toBeLessThan(40);
});

test('#5 AC1: a mousemove without real movement (window opening under the pointer) reveals nothing', async ({ page }) => {
  await page.keyboard.type('a');
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 0, movementY: 0 })));
  await page.waitForTimeout(300);
  expect(await controls(page).isVisible()).toBe(false);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('editor')).cursor)).toBe('none');
});

test('#5 AC1: buttons fade out ~2 s after the mouse stops', async ({ page }) => {
  await page.mouse.move(300, 300, { steps: 5 });
  await expect(controls(page)).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(controls(page)).toBeVisible();
  await expect(controls(page)).toBeHidden({ timeout: 1500 });
});

test('#5 AC1: buttons are hidden while typing', async ({ page }) => {
  await page.mouse.move(300, 300, { steps: 5 });
  await expect(controls(page)).toBeVisible();
  await page.keyboard.type('a');
  await expect(controls(page)).toBeHidden();
});

test('#5 AC2: each button has a tooltip naming its shortcut', async ({ page }) => {
  await page.mouse.move(300, 300, { steps: 5 });
  const expected = {
    'Sessions': shortcutLabel('O'),
    'New session': shortcutLabel('N'),
    'Text smaller': shortcutLabel('-'),
    'Text bigger': shortcutLabel('='),
    'Fullscreen': isMac ? '⌃⌘F' : 'F11', // #9 AC3
  };
  for (const [name, shortcut] of Object.entries(expected)) {
    expect(await button(page, name).getAttribute('title')).toContain(shortcut);
  }
});

test('#5 AC2: sessions and new-session buttons act like their shortcuts', async ({ page, dir }) => {
  await page.keyboard.type('Something');
  await page.mouse.move(300, 300, { steps: 5 });
  await button(page, 'Sessions').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#sidebar li')).toHaveCount(1);
  await button(page, 'Sessions').click();
  await expect(page.locator('#sidebar')).toBeHidden();

  await button(page, 'New session').click();
  await expect(page.locator('#editor')).toHaveText('');
  await expect(page.locator('#editor')).toBeFocused();
  await page.keyboard.type('Else');
  await expect.poll(() => fs.readdirSync(dir).length).toBe(2);
});

test('#5 AC2: text size buttons act like their shortcuts', async ({ page }) => {
  const start = await fontSize(page);
  await page.mouse.move(300, 300, { steps: 5 });
  await button(page, 'Text bigger').click();
  const bigger = await fontSize(page);
  expect(bigger).toBeGreaterThan(start);

  await button(page, 'Text smaller').click();
  await button(page, 'Text smaller').click();
  expect(await fontSize(page)).toBeLessThan(start);
});

test('#5 AC3: Ctrl/Cmd += / - / 0 enlarge, shrink and reset text size within bounds', async ({ page }) => {
  const initial = await fontSize(page);
  await page.keyboard.press(`${mod}+=`);
  expect(await fontSize(page)).toBeGreaterThan(initial);
  await page.keyboard.press(`${mod}+0`);
  expect(await fontSize(page)).toBe(initial);
  await page.keyboard.press(`${mod}+-`);
  expect(await fontSize(page)).toBeLessThan(initial);

  for (let i = 0; i < 40; i++) await page.keyboard.press(`${mod}+-`);
  const min = await fontSize(page);
  await page.keyboard.press(`${mod}+-`);
  expect(await fontSize(page)).toBe(min);
  expect(min).toBeGreaterThanOrEqual(10);

  for (let i = 0; i < 80; i++) await page.keyboard.press(`${mod}+=`);
  const max = await fontSize(page);
  await page.keyboard.press(`${mod}+=`);
  expect(await fontSize(page)).toBe(max);
  expect(max).toBeGreaterThan(initial);
  expect(max).toBeLessThanOrEqual(80);

  await page.keyboard.press(`${mod}+0`);
  expect(await fontSize(page)).toBe(initial);
  await expect(page.locator('#editor')).toHaveText('');
});

test('#5 AC4: text size persists across restarts', async () => {
  const dir = tempDir('fw-');
  const userData = tempDir('fw-');
  const first = await launch({ dir, userData });
  const initial = await fontSize(first.page);
  await first.page.keyboard.press(`${mod}+=`);
  await first.page.keyboard.press(`${mod}+=`);
  const chosen = await fontSize(first.page);
  expect(chosen).toBeGreaterThan(initial);
  await first.app.close();

  const second = await launch({ dir, userData });
  expect(await fontSize(second.page)).toBe(chosen);
  await second.app.close();

  expect(fs.readdirSync(dir)).toEqual([]); // settings don't live in the sessions folder
});

test('#5 AC5: F11 toggles fullscreen', async ({ app, page }) => {
  expect(await isFullScreen(app)).toBe(false);
  await page.keyboard.press('F11');
  await expect.poll(() => isFullScreen(app)).toBe(true);
  await page.keyboard.press('F11');
  await expect.poll(() => isFullScreen(app)).toBe(false);
});

test('#5 AC5: the fullscreen button toggles fullscreen', async ({ app, page }) => {
  await page.mouse.move(300, 300, { steps: 5 });
  await button(page, 'Fullscreen').click();
  await expect.poll(() => isFullScreen(app)).toBe(true);
  await page.mouse.move(310, 310, { steps: 5 });
  await button(page, 'Fullscreen').click();
  await expect.poll(() => isFullScreen(app)).toBe(false);
});

// --- #9 Controls polish ---------------------------------------------------------

const fullscreenKey = isMac ? 'Control+Meta+f' : 'F11';
const controlsOpacity = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('controls')).opacity));

test('#9 AC1: controls stay visible while the pointer rests on them', async ({ page }) => {
  await page.mouse.move(300, 300, { steps: 5 });
  const box = await button(page, 'Sessions').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.waitForTimeout(3500);
  await expect(controls(page)).toBeVisible();
  expect(await controlsOpacity(page)).toBeGreaterThanOrEqual(0.6);

  await page.mouse.move(300, 300, { steps: 5 }); // leaving starts the usual fade
  await expect(controls(page)).toBeHidden({ timeout: 3500 });
});

test('#9 AC2: shown controls rest at an opacity of at least 0.6', async ({ page }) => {
  await page.mouse.move(300, 300, { steps: 5 });
  await expect(controls(page)).toBeVisible();
  await page.waitForTimeout(500); // past the fade-in transition
  expect(await controlsOpacity(page)).toBeGreaterThanOrEqual(0.6);
});

test(`#9 AC3: ${fullscreenKey} toggles fullscreen and the button tooltip shows it`, async ({ app, page }) => {
  await page.mouse.move(300, 300, { steps: 5 });
  expect(await button(page, 'Fullscreen').getAttribute('title')).toContain(isMac ? '⌃⌘F' : 'F11');
  await page.keyboard.press(fullscreenKey);
  await expect.poll(() => isFullScreen(app)).toBe(true);
  await page.keyboard.press(fullscreenKey);
  await expect.poll(() => isFullScreen(app)).toBe(false);
});

test('#9 AC4: the sessions sidebar opens from the right edge', async ({ page }) => {
  await page.keyboard.press(`${mod}+o`);
  await expect(page.locator('#sidebar')).toBeVisible();
  const { left, right, width } = await page.evaluate(() => ({
    ...document.getElementById('sidebar').getBoundingClientRect().toJSON(),
    width: innerWidth,
  }));
  expect(right).toBe(width);
  expect(left).toBeGreaterThan(width / 2);
});

test('#9 AC4: with the sidebar open, the controls stay on top and can close it', async ({ page }) => {
  await page.mouse.move(300, 300, { steps: 5 });
  await button(page, 'Sessions').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await button(page, 'Sessions').click({ trial: true }); // throws if the sidebar covers the button
  await button(page, 'Sessions').click();
  await expect(page.locator('#sidebar')).toBeHidden();
});

// --- #30 Esc exits fullscreen ---------------------------------------------------

test('#30 AC1: in fullscreen, Esc returns to a normal window', async ({ app, page }) => {
  await page.keyboard.press(fullscreenKey);
  await expect.poll(() => isFullScreen(app)).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => isFullScreen(app)).toBe(false);
});

test('#30 AC1: in fullscreen, an Esc that closes the slash menu keeps fullscreen', async ({ app, page }) => {
  await page.keyboard.press(fullscreenKey);
  await expect.poll(() => isFullScreen(app)).toBe(true);
  await page.keyboard.type('/');
  await expect(page.locator('#slash-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#slash-menu')).toBeHidden();
  await page.waitForTimeout(500);
  expect(await isFullScreen(app)).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => isFullScreen(app)).toBe(false);
});

test('#30 AC2: outside fullscreen, Esc changes neither fullscreen nor the text', async ({ app, page }) => {
  await page.keyboard.type('Some words');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  expect(await isFullScreen(app)).toBe(false);
  await expect(page.locator('#editor')).toHaveText('Some words');
});

// --- #10 Ctrl+scroll zoom -------------------------------------------------------

/** One notch of the mouse wheel, with Ctrl/Cmd held; negative scrolls up. */
async function modWheel(page, notches) {
  await page.mouse.move(400, 300);
  await page.keyboard.down(mod);
  for (let i = 0; i < Math.abs(notches); i++) await page.mouse.wheel(0, Math.sign(notches) * 100);
  await page.keyboard.up(mod);
}

test('#10 AC1: Ctrl/Cmd+scroll up enlarges and down shrinks the text by the hotkey step', async ({ page }) => {
  const initial = await fontSize(page);
  await page.keyboard.press(`${mod}+=`);
  const step = (await fontSize(page)) - initial;
  await page.keyboard.press(`${mod}+0`);

  await modWheel(page, -1);
  await expect.poll(() => fontSize(page)).toBe(initial + step);
  await modWheel(page, 2);
  await expect.poll(() => fontSize(page)).toBe(initial - step);
});

test('#10 AC1: Ctrl/Cmd+scroll stops at the hotkey min and max', async ({ page }) => {
  for (let i = 0; i < 40; i++) await page.keyboard.press(`${mod}+=`);
  const max = await fontSize(page);
  for (let i = 0; i < 40; i++) await page.keyboard.press(`${mod}+-`);
  const min = await fontSize(page);

  await modWheel(page, -40);
  await expect.poll(() => fontSize(page)).toBe(max);
  await modWheel(page, 40);
  await expect.poll(() => fontSize(page)).toBe(min);
});

test('#10 AC1: small trackpad-style deltas add up to one step rather than one per event', async ({ page }) => {
  const initial = await fontSize(page);
  await page.mouse.move(400, 300);
  await page.keyboard.down(mod);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -4);
  await page.keyboard.up(mod);
  await page.waitForTimeout(200);
  expect(await fontSize(page)).toBe(initial);
});

test('#10 AC2: a size set with Ctrl/Cmd+scroll persists across restarts', async () => {
  const dir = tempDir('fw-');
  const userData = tempDir('fw-');
  const first = await launch({ dir, userData });
  const initial = await fontSize(first.page);
  await modWheel(first.page, -2);
  await expect.poll(() => fontSize(first.page)).toBeGreaterThan(initial);
  const chosen = await fontSize(first.page);
  await first.app.close();

  const second = await launch({ dir, userData });
  expect(await fontSize(second.page)).toBe(chosen);
  await second.app.close();
});

test('#10 AC3: scrolling without the modifier scrolls the text and keeps its size', async () => {
  const { app, page } = await launchWithSession(Array.from({ length: 80 }, (_, i) => `Paragraph ${i}`).join('\n\n'));
  const initial = await fontSize(page);
  const scrollTop = () => page.evaluate(() => document.getElementById('page').scrollTop);
  const before = await scrollTop();

  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, -300);
  await expect.poll(scrollTop).toBeLessThan(before);
  expect(await fontSize(page)).toBe(initial);
  await app.close();
});
