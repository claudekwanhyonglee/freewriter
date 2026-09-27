const { test, expect, launch, tempDir } = require('./fixture');

const rgb = (css) => css.match(/\d+/g).slice(0, 3).map(Number);

async function colours(page) {
  return page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.getElementById('editor')).color,
  }));
}

// Emulates the OS setting as Chromium sees it; nativeTheme.themeSource doesn't reach headless Xvfb.
async function setTheme(page, theme) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await expect.poll(() => page.evaluate((t) => matchMedia(`(prefers-color-scheme: ${t})`).matches, theme)).toBe(true);
}

test('#2 AC1: window shows within 2 s with a focused, empty editor that accepts typing', async () => {
  const started = Date.now();
  const { app, page } = await launch({ dir: tempDir('fw-'), userData: tempDir('fw-') });
  await expect(page.locator('#editor')).toBeVisible();
  expect(Date.now() - started).toBeLessThan(2000);

  await expect(page.locator('#editor')).toBeFocused();
  await expect(page.locator('#editor')).toHaveValue('');
  await page.keyboard.type('hello');
  await expect(page.locator('#editor')).toHaveValue('hello');
  await app.close();
});

test('#2 AC2: no menu bar, toolbar or status bar is visible', async ({ app, page }) => {
  if (process.platform !== 'darwin') {
    const menuVisible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible());
    expect(menuVisible).toBe(false);
  }
  const visibleOtherThanEditor = await page.evaluate(() =>
    [...document.body.querySelectorAll('*')].filter((el) =>
      el.id !== 'editor' && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && el.getClientRects().length > 0
    ).length
  );
  expect(visibleOtherThanEditor).toBe(0);
});

for (const [width, height] of [[1024, 768], [1920, 1080], [3840, 2160]]) {
  test(`#2 AC3: text column is centred and at most ~65ch wide at ${width}x${height}`, async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

    const m = await page.evaluate(() => {
      const editor = document.getElementById('editor');
      const style = getComputedStyle(editor);
      const probe = document.createElement('span');
      probe.style.cssText = `font: ${style.font}; position: absolute; width: 65ch;`;
      document.body.appendChild(probe);
      const maxText = probe.getBoundingClientRect().width;
      probe.remove();
      const rect = editor.getBoundingClientRect();
      const textWidth = rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const textLeft = rect.left + parseFloat(style.paddingLeft);
      return { viewport: innerWidth, textWidth, textLeft, maxText };
    });

    expect(m.viewport).toBe(width);
    expect(m.textWidth).toBeLessThanOrEqual(m.maxText + 1);
    expect(m.textWidth).toBeGreaterThan(m.maxText * 0.6);
    const rightGap = m.viewport - (m.textLeft + m.textWidth);
    expect(Math.abs(m.textLeft - rightGap)).toBeLessThanOrEqual(1);
  });
}

test('#2 AC4: light theme is warm off-white with dark-grey text', async ({ page }) => {
  await setTheme(page, 'light');
  const { background, text } = await colours(page);
  const [r, g, b] = rgb(background);
  expect(r).toBeGreaterThan(235);
  expect(r).toBeGreaterThanOrEqual(g);
  expect(g).toBeGreaterThan(b); // warm: red/yellow over blue
  expect([r, g, b]).not.toEqual([255, 255, 255]);
  const [tr, tg, tb] = rgb(text);
  expect(Math.max(tr, tg, tb)).toBeLessThan(100);
  expect(Math.max(tr, tg, tb) - Math.min(tr, tg, tb)).toBeLessThan(20);
  expect([tr, tg, tb]).not.toEqual([0, 0, 0]);
});

test('#2 AC4: dark theme is dim charcoal with light-grey text', async ({ page }) => {
  await setTheme(page, 'dark');
  const { background, text } = await colours(page);
  const [r, g, b] = rgb(background);
  expect(Math.max(r, g, b)).toBeLessThan(60);
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(20);
  expect([r, g, b]).not.toEqual([0, 0, 0]);
  const [tr, tg, tb] = rgb(text);
  expect(Math.min(tr, tg, tb)).toBeGreaterThan(170);
  expect(Math.max(tr, tg, tb) - Math.min(tr, tg, tb)).toBeLessThan(20);
  expect([tr, tg, tb]).not.toEqual([255, 255, 255]);
});

test('#2 AC5: cursor hides after a keystroke and reappears on mouse move', async ({ page }) => {
  const cursor = () => page.evaluate(() => getComputedStyle(document.getElementById('editor')).cursor);
  await page.mouse.move(200, 200);
  expect(await cursor()).not.toBe('none');
  await page.keyboard.type('a');
  expect(await cursor()).toBe('none');
  await page.mouse.move(210, 210);
  expect(await cursor()).not.toBe('none');
});
