const { test, expect, launch, launchWithSession, mod, seed, tempDir } = require('./fixture');

const WRAPPING = 'This sentence goes on long enough that it has to wrap onto a second line of the column, '.repeat(3).trim();

/** Viewport top of the first line of the paragraph whose text starts with `start`. */
const lineTop = (page, start) => page.evaluate((start) => {
  const p = [...document.querySelectorAll('#editor p')].find((el) => el.textContent.startsWith(start));
  const range = document.createRange();
  range.selectNodeContents(p);
  return range.getClientRects()[0].top;
}, start);

/** Distance between the first two lines of a soft-wrapped paragraph. */
const wrapDistance = (page) => page.evaluate((start) => {
  const p = [...document.querySelectorAll('#editor p')].find((el) => el.textContent.startsWith(start));
  const range = document.createRange();
  range.selectNodeContents(p);
  const tops = [...new Set([...range.getClientRects()].map((r) => Math.round(r.top * 10) / 10))].sort((a, b) => a - b);
  return tops[1] - tops[0];
}, WRAPPING.slice(0, 20));

const gap = async (page, above, below) => (await lineTop(page, below)) - (await lineTop(page, above));
const paragraphs = (page) => page.locator('#editor > p').allTextContents();

async function typeLines(page, lines) {
  for (const [i, line] of lines.entries()) {
    if (i) await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
}

test('#41 AC1: one Enter moves down exactly one wrapped line', async ({ page }) => {
  await typeLines(page, [WRAPPING, 'First', 'Second']);
  const wrap = await wrapDistance(page);
  expect(wrap).toBeGreaterThan(0);
  expect(Math.abs(await gap(page, 'First', 'Second') - wrap)).toBeLessThanOrEqual(1);
});

test('#41 AC2: a double Enter leaves exactly one empty line', async ({ page }) => {
  await typeLines(page, [WRAPPING, 'First', '', 'Second']);
  const wrap = await wrapDistance(page);
  expect(Math.abs(await gap(page, 'First', 'Second') - 2 * wrap)).toBeLessThanOrEqual(1);
});

const LINES = [WRAPPING, 'One', 'Two', '', 'Three', '', '', 'Four'];

async function measure(page) {
  const wrap = await wrapDistance(page);
  return {
    paragraphs: await paragraphs(page),
    gaps: [await gap(page, 'One', 'Two'), await gap(page, 'Two', 'Three'), await gap(page, 'Three', 'Four')].map((g) => Math.round(g / wrap)),
  };
}

test('#41 AC3: lines and empty lines, with their gaps, survive a save and reopen', async () => {
  const dir = tempDir('fw-');
  const userData = tempDir('fw-');
  const first = await launch({ dir, userData });
  await typeLines(first.page, LINES);
  const written = await measure(first.page);
  expect(written.gaps).toEqual([1, 2, 3]);
  expect(written.paragraphs.filter((text) => text === '')).toHaveLength(3);
  await first.app.close();

  const second = await launch({ dir, userData });
  await second.page.keyboard.press(`${mod}+o`);
  await second.page.locator('#sidebar li').first().click();
  expect(await measure(second.page)).toEqual(written);
  await second.app.close();
});

test('#41 AC3: lines and empty lines, with their gaps, survive switching sessions and back', async () => {
  const dir = tempDir('fw-');
  seed(dir, { '2020-01-01 09-00-00.md': 'Another session' });
  const { app, page } = await launch({ dir, userData: tempDir('fw-') });
  await typeLines(page, LINES);
  const written = await measure(page);

  await page.keyboard.press(`${mod}+o`);
  await page.locator('#sidebar li', { hasText: 'Another session' }).click();
  await expect(page.locator('#editor')).toHaveText('Another session');
  await page.locator('#sidebar li', { hasText: 'This sentence' }).click();
  expect(await measure(page)).toEqual(written);
  await app.close();
});

// Measured on 0.4.0, in em of the text size: the space between one block and the next.
const BLOCK_GAPS = {
  'P>H1': 1.68, 'H1>P': 0.56, 'P>H2': 1.44, 'H2>P': 0.48, 'P>H3': 1.26, 'H3>P': 0.42,
  'P>UL': 0.6, 'UL>P': 0.6, 'P>OL': 0.6, 'OL>P': 0.6, 'P>BLOCKQUOTE': 0.6, 'BLOCKQUOTE>P': 0.6,
  'P>PRE': 0.6, 'PRE>P': 0.51, 'P>TABLE': 0.6, 'TABLE>P': 0.6, 'P>HR': 1.2, 'HR>P': 1.2,
};

const BLOCKS = [
  'Para', '# Heading 1', 'Para', '## Heading 2', 'Para', '### Heading 3', 'Para',
  '- item\n- item', 'Para', '1. one\n2. two', 'Para', '> quote', 'Para',
  '```\ncode\n```', 'Para', '| a | b |\n| - | - |\n| 1 | 2 |', 'Para', '---', 'Para',
].join('\n\n');

test('#41 AC4: headings, lists, quotes, code, tables and rules keep their spacing', async () => {
  const { app, page } = await launchWithSession(BLOCKS);
  const gaps = await page.evaluate(() => {
    const editor = document.getElementById('editor');
    const em = parseFloat(getComputedStyle(editor).fontSize);
    const blocks = [...editor.children];
    return Object.fromEntries(blocks.slice(1).map((block, i) => [
      `${blocks[i].tagName}>${block.tagName}`,
      (block.getBoundingClientRect().top - blocks[i].getBoundingClientRect().bottom) / em,
    ]));
  });
  expect(Object.keys(gaps).sort()).toEqual(Object.keys(BLOCK_GAPS).sort());
  for (const [pair, expected] of Object.entries(BLOCK_GAPS)) expect(gaps[pair], pair).toBeCloseTo(expected, 1);
  await app.close();
});
