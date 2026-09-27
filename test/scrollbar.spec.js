const { test, expect, launch, launchWithSession, tempDir } = require('./fixture');

const LONG_DOC = Array.from({ length: 80 }, (_, i) => `Paragraph ${i}`).join('\n\n');
const THEMES = ['light', 'dark'];
const SETTLE_MS = 600; // longer than the controls' fades (0.15 s in, 0.4 s out)
const CONTROLS_LINGER_MS = 2000; // renderer.js

const rgb = (css) => css.match(/[\d.]+/g).slice(0, 3).map(Number);
const sum = (colour) => colour.reduce((a, b) => a + b, 0);

/**
 * Brightness sums (R+G+B; channel order doesn't matter) of the scrollbar strip, one per row of pixels:
 * each row's pixel furthest from the background. Painted pixels, so it sees what the user sees.
 */
const scrollbarRows = (app) => app.evaluate(async ({ BrowserWindow }) => {
  const wc = BrowserWindow.getAllWindows()[0].webContents;
  const { x, width, height, bg } = await wc.executeJavaScript(`(() => {
    const page = document.getElementById('page');
    const width = (page.offsetWidth - page.clientWidth) / 2; // gutters on both edges; the bar is the right one
    const bg = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).slice(0, 3).map(Number);
    return { x: innerWidth - width, width, height: innerHeight, bg: bg[0] + bg[1] + bg[2] };
  })()`);
  const image = await wc.capturePage({ x, y: 0, width, height });
  const { width: w, height: h } = image.getSize();
  const bitmap = image.toBitmap();
  const rows = [];
  for (let y = 0; y < h; y++) {
    let furthest = bg;
    for (let i = y * w * 4; i < (y + 1) * w * 4; i += 4) {
      const s = bitmap[i] + bitmap[i + 1] + bitmap[i + 2];
      if (Math.abs(s - bg) > Math.abs(furthest - bg)) furthest = s;
    }
    rows.push(furthest);
  }
  return rows;
});

/** The thumb's colour sum (the row furthest from the background), and the background's. */
async function thumb(app, page) {
  const rows = await scrollbarRows(app);
  const bg = sum(rgb(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)));
  const furthest = rows.reduce((a, b) => (Math.abs(b - bg) > Math.abs(a - bg) ? b : a), bg);
  return { value: furthest, bg };
}

/** What the controls' icons look like: the text colour at the controls' shown opacity, over the background. */
async function controlsColourSum(page) {
  const { text, background, opacity } = await page.evaluate(() => ({
    text: getComputedStyle(document.getElementById('editor')).color,
    background: getComputedStyle(document.body).backgroundColor,
    opacity: parseFloat(getComputedStyle(document.getElementById('controls')).opacity),
  }));
  const [t, b] = [rgb(text), rgb(background)];
  return sum(t.map((c, i) => opacity * c + (1 - opacity) * b[i]));
}

const setTheme = (page, theme) => page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
const scrollTo = (page, top) => page.evaluate((top) => { document.getElementById('page').scrollTop = top; }, top);

async function showControls(page) {
  await page.mouse.move(300, 300, { steps: 3 });
  await page.mouse.move(320, 310, { steps: 3 });
  await expect(page.locator('#controls')).toHaveClass(/shown/);
}

const isTransparent = async (app, page) => {
  const { value, bg } = await thumb(app, page);
  return Math.abs(value - bg) <= 3;
};

/** The thumb's colour sum, sampled as often as possible for `ms`. */
async function sample(app, page, ms) {
  const samples = [];
  const start = Date.now();
  while (Date.now() - start < ms) samples.push((await thumb(app, page)).value);
  return samples;
}

/** Clearly between two colour sums: a frame of a fade, not either end. */
const strictlyBetween = (a, b) => (s) => s > Math.min(a, b) + 12 && s < Math.max(a, b) - 12;

for (const theme of THEMES) {
  test(`#40 AC1: the scrollbar is thinner than Chromium's default, with a transparent track and no arrow buttons (${theme})`, async () => {
    const { app, page } = await launchWithSession(LONG_DOC);
    await setTheme(page, theme);

    const { ours, chromiumDefault } = await page.evaluate(() => {
      const probe = Object.assign(document.createElement('div'), { style: 'position: absolute; overflow: scroll; width: 100px; height: 100px' });
      document.body.append(probe);
      const chromiumDefault = probe.offsetWidth - probe.clientWidth;
      probe.remove();
      const el = document.getElementById('page');
      return { ours: (el.offsetWidth - el.clientWidth) / 2, chromiumDefault };
    });
    expect(ours).toBeGreaterThan(0);
    if (chromiumDefault > 0) expect(ours).toBeLessThan(chromiumDefault); // macOS overlay bars take no width: nothing to be thinner than

    // Hidden, the whole strip is background: no track and no buttons are painted.
    await page.waitForTimeout(SETTLE_MS);
    const { bg } = await thumb(app, page);
    for (const row of await scrollbarRows(app)) expect(Math.abs(row - bg)).toBeLessThanOrEqual(3);

    // Shown, the thumb reaches the very top and bottom of the strip: no arrow buttons take room there.
    const painted = async () => (await scrollbarRows(app)).map((row, y) => (Math.abs(row - bg) > 20 ? y : null)).filter((y) => y !== null);
    await scrollTo(page, 0);
    await showControls(page);
    await page.waitForTimeout(SETTLE_MS);
    expect((await painted())[0]).toBeLessThanOrEqual(2);
    await scrollTo(page, 1e9);
    await showControls(page);
    await page.waitForTimeout(SETTLE_MS);
    const height = await page.evaluate(() => innerHeight);
    expect((await painted()).at(-1)).toBeGreaterThanOrEqual(height - 3);
    await app.close();
  });

  test(`#40 AC2: the visible thumb is the controls' colour (${theme})`, async () => {
    const { app, page } = await launchWithSession(LONG_DOC);
    await setTheme(page, theme);
    await showControls(page);
    await page.waitForTimeout(SETTLE_MS);
    expect(Math.abs((await thumb(app, page)).value - await controlsColourSum(page))).toBeLessThanOrEqual(6);
    await app.close();
  });
}

test('#40 AC3: the text column keeps its width and position when the text starts to overflow', async () => {
  const { app, page } = await launch({ dir: tempDir('fw-'), userData: tempDir('fw-') });
  const column = () => page.evaluate(() => {
    const editor = document.getElementById('editor');
    const style = getComputedStyle(editor);
    const rect = editor.getBoundingClientRect();
    return { left: rect.left + parseFloat(style.paddingLeft), width: rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
  });
  const overflows = () => page.evaluate(() => { const el = document.getElementById('page'); return el.scrollHeight > el.clientHeight; });

  await page.keyboard.type('First line');
  expect(await overflows()).toBe(false);
  const before = await column();
  for (let i = 0; i < 40 && !(await overflows()); i++) await page.keyboard.press('Enter');
  expect(await overflows()).toBe(true);
  expect(await column()).toEqual(before);
  await app.close();
});

test('#40 AC4: while typing the thumb is fully transparent, even as the page scrolls to follow the caret', async () => {
  const { app, page } = await launchWithSession(LONG_DOC);
  await showControls(page);
  await page.keyboard.type('a');
  await page.waitForTimeout(SETTLE_MS);
  expect(await isTransparent(app, page)).toBe(true);

  const scrollTop = () => page.evaluate(() => document.getElementById('page').scrollTop);
  const before = await scrollTop();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Enter');
    await page.keyboard.type('more');
  }
  expect(await scrollTop()).toBeGreaterThan(before);
  await page.waitForTimeout(SETTLE_MS);
  expect(await isTransparent(app, page)).toBe(true);
  await app.close();
});

test('#40 AC5: a real mouse move fades the thumb in', async () => {
  const { app, page } = await launchWithSession(LONG_DOC);
  await page.keyboard.type('a');
  await page.waitForTimeout(SETTLE_MS);
  const { bg } = await thumb(app, page);
  await page.mouse.move(300, 300);
  await page.mouse.move(310, 310);
  const samples = await sample(app, page, 700);
  const shown = await controlsColourSum(page); // read once the controls have settled
  expect(samples.some(strictlyBetween(bg, shown)), `samples: ${samples}`).toBe(true);
  expect(Math.abs(samples.at(-1) - shown)).toBeLessThanOrEqual(6);
  await app.close();
});

test('#40 AC5: scrolling the page fades the thumb in', async () => {
  const { app, page } = await launchWithSession(LONG_DOC);
  await page.mouse.move(400, 300);
  await page.keyboard.type('a'); // hides everything; the pointer now rests over the text
  await page.waitForTimeout(SETTLE_MS);
  const { bg } = await thumb(app, page);
  await page.mouse.wheel(0, -300);
  const samples = await sample(app, page, 700);
  const shown = await controlsColourSum(page); // read once the controls have settled
  expect(samples.some(strictlyBetween(bg, shown)), `samples: ${samples}`).toBe(true);
  expect(Math.abs(samples.at(-1) - shown)).toBeLessThanOrEqual(6);
  await app.close();
});

test('#40 AC6: when the controls hide, the thumb fades out', async () => {
  const { app, page } = await launchWithSession(LONG_DOC);
  await showControls(page);
  await page.waitForTimeout(SETTLE_MS);
  const { value: shown, bg } = await thumb(app, page);
  await page.waitForTimeout(CONTROLS_LINGER_MS - SETTLE_MS - 300); // sample from just before the controls hide
  const samples = await sample(app, page, 1000);
  await expect(page.locator('#controls')).not.toHaveClass(/shown/);
  expect(samples.some(strictlyBetween(shown, bg)), `samples: ${samples}`).toBe(true);
  expect(await isTransparent(app, page)).toBe(true);
  await app.close();
});
