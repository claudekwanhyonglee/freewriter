const fs = require('fs');
const { test, expect, launchWithSession } = require('./fixture');

const FONTS = ['Atkinson Hyperlegible', 'EB Garamond', 'iA Writer Mono', 'Inter', 'Literata', 'Source Serif 4'];
const SIZES = [14, 22, 40];

/** Vertical centres of each checklist item's box and of its first line of text. */
const checklistCentres = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#editor li.task')].map((item) => {
    const box = item.querySelector(':scope > input').getBoundingClientRect();
    const text = item.querySelector('p');
    const firstLine = text.getBoundingClientRect().top + parseFloat(getComputedStyle(text).lineHeight) / 2;
    return { box: box.top + box.height / 2, firstLine, lines: Math.round(text.offsetHeight / parseFloat(getComputedStyle(text).lineHeight)) };
  }));

async function useTypeface(page, font, size) {
  await page.evaluate(async ({ font, size }) => {
    document.documentElement.style.setProperty('--prose-font', `"${font}"`);
    document.documentElement.style.setProperty('--font-size', `${size}px`);
    await document.fonts.load(`${size}px "${font}"`, 'task');
    await document.fonts.ready;
  }, { font, size });
}

/** Where every checklist box and line of text sits, to check nothing moved. */
const layout = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#editor li.task > input, #editor li.task p')].map((el) => {
    const { top, left } = el.getBoundingClientRect();
    return { top, left };
  }));

test('#22 AC1: each checkbox is centred on its first line of text at every text size and font', async () => {
  const { app, page } = await launchWithSession('- [ ] open task\n- [x] done task');
  for (const font of FONTS) {
    for (const size of SIZES) {
      await useTypeface(page, font, size);
      for (const { box, firstLine } of await checklistCentres(page)) {
        expect(Math.abs(box - firstLine), `${font} at ${size}px`).toBeLessThanOrEqual(2);
      }
    }
  }
  await app.close();
});

test('#22 AC1: the checkbox scales with the text size', async () => {
  const { app, page } = await launchWithSession('- [ ] task');
  const boxHeight = () => page.locator('#editor li.task > input').evaluate((el) => el.getBoundingClientRect().height);
  await useTypeface(page, 'Inter', 14);
  const small = await boxHeight();
  await useTypeface(page, 'Inter', 40);
  expect(await boxHeight()).toBeGreaterThan(small * 2);
  await app.close();
});

test('#22 AC2: in an item that wraps onto several lines the box stays on the first line', async () => {
  const { app, page } = await launchWithSession(`- [ ] ${'a long task that keeps going '.repeat(12)}`);
  for (const size of SIZES) {
    await useTypeface(page, 'Literata', size);
    const [{ box, firstLine, lines }] = await checklistCentres(page);
    expect(lines).toBeGreaterThan(1);
    expect(Math.abs(box - firstLine)).toBeLessThanOrEqual(2);
  }
  await app.close();
});

// Changed by #45 AC3: the empty item used to be removed with the caret going to the end of the item above.
test('#22 AC3 (#45 AC3): Backspace in an empty item makes it a plain line in place; the items above stay put', async () => {
  const { app, page, file } = await launchWithSession('- [ ] one\n- [x] two\n- [ ] three');
  for (let i = 0; i < 'three'.length; i++) await page.keyboard.press('Backspace');
  await expect(page.locator('#editor li.task')).toHaveText(['one', 'two', '']);
  const before = (await layout(page)).slice(0, 4); // boxes and text of "one" and "two"

  await page.keyboard.press('Backspace');
  await expect(page.locator('#editor li.task')).toHaveText(['one', 'two']);
  await expect(page.locator('#editor > p')).toHaveText(['']);
  const after = await layout(page);
  expect(after).toHaveLength(4);
  after.forEach(({ top, left }, i) => {
    expect(Math.abs(top - before[i].top)).toBeLessThanOrEqual(1);
    expect(Math.abs(left - before[i].left)).toBeLessThanOrEqual(1);
  });

  await page.keyboard.type('!');
  await expect(page.locator('#editor li.task')).toHaveText(['one', 'two']);
  await expect(page.locator('#editor > p')).toHaveText(['!']);
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('- [ ] one\n- [x] two\n\n!');
  await app.close();
});

test('#22 AC4: Backspace in an empty item with no item above turns it into an empty normal line', async () => {
  const { app, page } = await launchWithSession('- [ ] only');
  for (let i = 0; i < 'only'.length; i++) await page.keyboard.press('Backspace');
  await expect(page.locator('#editor li.task')).toHaveText(['']);

  await page.keyboard.press('Backspace');
  await expect(page.locator('#editor li')).toHaveCount(0);
  await expect(page.locator('#editor > p')).toHaveText(['']);
  await page.keyboard.type('plain');
  await expect(page.locator('#editor > p')).toHaveText(['plain']);
  await app.close();
});
