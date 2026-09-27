const fs = require('fs');
const { test, expect, launch, launchWithSession, tempDir, setOsTheme: setTheme } = require('./fixture');

const rgb = (css) => css.match(/\d+/g).slice(0, 3).map(Number);

async function colours(page) {
  return page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.getElementById('editor')).color,
  }));
}

test('#2 AC1: window shows within 2 s with a focused, empty editor that accepts typing', async () => {
  const started = Date.now();
  const { app, page } = await launch({ dir: tempDir('fw-'), userData: tempDir('fw-') });
  await expect(page.locator('#editor')).toBeVisible();
  expect(Date.now() - started).toBeLessThan(2000);

  await expect(page.locator('#editor')).toBeFocused();
  await expect(page.locator('#editor')).toHaveText('');
  await page.keyboard.type('hello');
  await expect(page.locator('#editor')).toHaveText('hello');
  await app.close();
});

test('#2 AC2: no menu bar, toolbar or status bar is visible', async ({ app, page }) => {
  if (process.platform !== 'darwin') {
    const menuVisible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible());
    expect(menuVisible).toBe(false);
  }
  const visibleOtherThanEditor = await page.evaluate(() =>
    [...document.body.querySelectorAll('*')].filter((el) =>
      !el.closest('#page') && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && el.getClientRects().length > 0
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

// --- #32 Scroll past the end -----------------------------------------------------

const LONG_DOC = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}`).join('\n\n');

/** Viewport tops of the first and last line of text, and the page's scroll position. */
const lineTops = (page) => page.evaluate(() => {
  const editor = document.getElementById('editor');
  const lineTop = (textNode, which) => {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rects = range.getClientRects();
    return (which === 'first' ? rects[0] : rects[rects.length - 1]).top;
  };
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  return { first: lineTop(texts[0], 'first'), last: lineTop(texts.at(-1), 'last') };
});

const scrollTo = (page, top) => page.evaluate((top) => {
  const scroller = document.getElementById('page');
  scroller.scrollTop = top;
  return scroller.scrollTop;
}, top);

test('#32 AC1: a long doc scrolls until its last line sits where the first line starts, and no further', async () => {
  const { app, page } = await launchWithSession(LONG_DOC);
  await scrollTo(page, 0);
  const firstLineTop = (await lineTops(page)).first;

  await scrollTo(page, 1e9); // clamped to the furthest the page can scroll
  const { last } = await lineTops(page);
  expect(Math.abs(last - firstLineTop)).toBeLessThanOrEqual(2);
  const viewportHeight = await page.evaluate(() => innerHeight);
  expect(last).toBeGreaterThanOrEqual(0);
  expect(last).toBeLessThan(viewportHeight);
  await app.close();
});

test('#32 AC1: the last line stays visible at any text size', async () => {
  const { app, page } = await launchWithSession(LONG_DOC);
  for (const size of ['14px', '40px']) {
    await page.evaluate((size) => document.documentElement.style.setProperty('--font-size', size), size);
    await scrollTo(page, 0);
    const firstLineTop = (await lineTops(page)).first;
    await scrollTo(page, 1e9);
    expect(Math.abs((await lineTops(page)).last - firstLineTop)).toBeLessThanOrEqual(2);
  }
  await app.close();
});

test('#32 AC2: the space below the text is empty and the saved text is unchanged', async () => {
  const { app, page, file } = await launchWithSession(LONG_DOC);
  await scrollTo(page, 1e9);
  const below = await page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight - 20);
    return el.id || el.className;
  });
  expect(['editor', 'page']).toContain(below);
  expect(await page.locator('#editor').innerText()).toBe(LONG_DOC);
  await app.close();
  expect(fs.readFileSync(file, 'utf8')).toBe(LONG_DOC);
});

test('#32 AC3: typing at the end of a doc keeps the cursor line in view', async () => {
  const { app, page } = await launchWithSession(LONG_DOC);
  await page.keyboard.press('Control+End');
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`More ${i}`);
  }
  const caret = await page.evaluate(() => {
    const rect = getSelection().getRangeAt(0).getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: innerHeight };
  });
  expect(caret.top).toBeGreaterThanOrEqual(0);
  expect(caret.bottom).toBeLessThanOrEqual(caret.height);
  await app.close();
});
