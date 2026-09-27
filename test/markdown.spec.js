const fs = require('fs');
const path = require('path');
const { test, expect, launch, launchWithSession, mod, seed, tempDir } = require('./fixture');

const editor = (page) => page.locator('#editor');
const mdFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
const savedText = (dir) => fs.readFileSync(path.join(dir, mdFiles(dir)[0]), 'utf8');

// A 1×1 PNG, for an image the session references by a relative path.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

// Every construct, written the way the editor writes markdown back.
const EVERYTHING = `# Heading one

## Heading two

### Heading three

Some **bold**, *italic*, \`code\` and ~~strike~~ with a [link](https://example.com).

![a pixel](pixel.png)

- bullet one
- bullet two

1. first
2. second

- [ ] open task
- [x] done task

> a quote

---

\`\`\`
code block
\`\`\`

| A | B |
| - | - |
| 1 | 2 |

The end.`;

// --- AC1: shortcuts ----------------------------------------------------------------

const shortcuts = [
  { typed: '- item', element: 'ul > li', text: 'item' },
  { typed: '* item', element: 'ul > li', text: 'item' },
  { typed: '1. item', element: 'ol > li', text: 'item' },
  { typed: '[ ] task', element: 'ul > li.task', text: 'task' },
  { typed: '# Title', element: 'h1', text: 'Title' },
  { typed: '## Title', element: 'h2', text: 'Title' },
  { typed: '### Title', element: 'h3', text: 'Title' },
  { typed: '> quoted', element: 'blockquote', text: 'quoted' },
  { typed: '---', element: 'hr', text: '' },
  { typed: '```\nsome code', element: 'pre code', text: 'some code' },
  { typed: 'a **bold** word', element: 'strong', text: 'bold', all: 'a bold word' },
  { typed: 'an *italic* word', element: 'em', text: 'italic', all: 'an italic word' },
  { typed: 'some `code` here', element: 'p code', text: 'code', all: 'some code here' },
  { typed: 'a ~~struck~~ word', element: 'del', text: 'struck', all: 'a struck word' },
];

for (const { typed, element, text, all = text } of shortcuts) {
  test(`#14 AC1: typing ${JSON.stringify(typed)} formats it with the markers hidden`, async ({ page }) => {
    await page.keyboard.type(typed);
    await expect(editor(page).locator(element)).toHaveText(text);
    await expect(editor(page)).toHaveText(all);
  });
}

test('#14 AC1: a typed checklist item starts unchecked', async ({ page }) => {
  await page.keyboard.type('[ ] task');
  await expect(editor(page).locator('li.task input[type=checkbox]')).not.toBeChecked();
});

// --- AC2: opening and saving ---------------------------------------------------------

test('#14 AC2: an existing session opens formatted, links, images and tables included', async () => {
  const dir = tempDir('fw-');
  fs.writeFileSync(path.join(dir, 'pixel.png'), PIXEL);
  const { app, page } = await launchWithSession(EVERYTHING, { dir });
  const e = editor(page);

  for (const [selector, text] of [
    ['h1', 'Heading one'], ['h2', 'Heading two'], ['h3', 'Heading three'],
    ['strong', 'bold'], ['em', 'italic'], ['p > code', 'code'], ['del', 'strike'], ['a[href="https://example.com"]', 'link'],
    ['ul > li >> nth=0', 'bullet one'], ['ol > li >> nth=1', 'second'],
    ['li.task >> nth=0', 'open task'], ['blockquote', 'a quote'], ['pre code', 'code block'],
    ['table th >> nth=1', 'B'], ['table td >> nth=0', '1'],
  ]) await expect(e.locator(selector)).toHaveText(text);
  await expect(e.locator('li.task input').nth(0)).not.toBeChecked();
  await expect(e.locator('li.task input').nth(1)).toBeChecked();
  await expect(e.locator('hr')).toHaveCount(1);
  await expect(e.locator('img[alt="a pixel"]')).toHaveJSProperty('naturalWidth', 1); // loaded from the sessions folder
  await expect(e).not.toContainText('#');
  await expect(e).not.toContainText('|');
  await expect(e).not.toContainText('**');
  await app.close();
});

test('#14 AC2: after an edit the file is standard markdown that reopens identically', async () => {
  const dir = tempDir('fw-');
  const userData = tempDir('fw-');
  const first = await launchWithSession(EVERYTHING, { dir, userData });
  await first.page.keyboard.type(' More.'); // the caret opens at the end
  await expect.poll(() => fs.readFileSync(first.file, 'utf8')).toBe(`${EVERYTHING} More.`);
  const html = await editor(first.page).innerHTML();
  await first.app.close();

  expect(fs.readFileSync(first.file, 'utf8')).toBe(`${EVERYTHING} More.`);
  const second = await launchWithSession(fs.readFileSync(first.file, 'utf8'), { dir, userData });
  expect(await editor(second.page).innerHTML()).toBe(html);
  await second.app.close();
  expect(fs.readFileSync(first.file, 'utf8')).toBe(`${EVERYTHING} More.`); // opening alone doesn't rewrite it
});

test('#14 AC2: opening a session does not rewrite a hand-written file', async () => {
  const handWritten = '* star bullet\n\nText  with  spaces\n';
  const { app, file } = await launchWithSession(handWritten);
  await app.close();
  expect(fs.readFileSync(file, 'utf8')).toBe(handWritten);
});

// --- AC3: paste ----------------------------------------------------------------------

test('#14 AC3: pasted markdown text is inserted formatted', async ({ page }) => {
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', '## Pasted\n\n- one\n- **two**');
    document.getElementById('editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(editor(page).locator('h2')).toHaveText('Pasted');
  await expect(editor(page).locator('li')).toHaveText(['one', 'two']);
  await expect(editor(page).locator('li strong')).toHaveText('two');
  await expect(editor(page)).not.toContainText('##');
});

// --- AC4: checklists -------------------------------------------------------------------

test('#14 AC4: clicking a checklist box toggles it and saves - [x] / - [ ]', async () => {
  const { app, page, file } = await launchWithSession('- [ ] task one\n- [ ] task two');
  const box = editor(page).locator('li.task input').first();
  await box.click();
  await expect(box).toBeChecked();
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('- [x] task one\n- [ ] task two');
  await box.click();
  await expect(box).not.toBeChecked();
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('- [ ] task one\n- [ ] task two');
  await app.close();
});

test('#14 AC4: a typed checklist is saved as - [ ]', async ({ page, dir }) => {
  await page.keyboard.type('[ ] buy milk');
  await expect.poll(() => mdFiles(dir).length && savedText(dir)).toBe('- [ ] buy milk');
});

// --- AC5: links ------------------------------------------------------------------------

test('#14 AC5: Ctrl/Cmd+click opens a link in the OS browser; the app never navigates', async () => {
  const { app, page } = await launchWithSession('Go to [the site](https://example.com/page) now');
  await app.evaluate(({ shell }) => {
    globalThis.opened = [];
    shell.openExternal = async (url) => { globalThis.opened.push(url); };
  });
  const opened = () => app.evaluate(() => globalThis.opened);
  const pageUrl = page.url();
  const link = editor(page).locator('a');

  await link.click();
  await page.waitForTimeout(300);
  expect(await opened()).toEqual([]);

  await link.click({ modifiers: [mod] });
  await expect.poll(opened).toEqual(['https://example.com/page']);
  await page.waitForTimeout(300);
  expect(page.url()).toBe(pageUrl);
  expect(app.windows()).toHaveLength(1);
  await expect(editor(page)).toContainText('Go to the site now');
  await app.close();
});

// --- AC6: sidebar and existing behaviour -----------------------------------------------

test('#14 AC6: the sidebar preview shows the first line as plain text', async () => {
  const dir = tempDir('fw-');
  seed(dir, {
    '2025-01-01 10-00-00.md': '# **Big** day\n\nmore',
    '2025-01-02 10-00-00.md': '- [ ] buy *milk* and `eggs`',
    '2025-01-03 10-00-00.md': '> see [the ~~old~~ site](https://example.com) ![pic](x.png)',
  });
  const { app, page } = await launch({ dir, userData: tempDir('fw-') });
  await page.keyboard.press(`${mod}+o`);
  await expect(page.locator('#sidebar .preview')).toHaveText(['see the old site pic', 'buy milk and eggs', 'Big day']);
  await app.close();
});

test('#14 AC6: formatted text autosaves as markdown and shows in the sidebar', async ({ page, dir }) => {
  await page.keyboard.type('## Morning\nI *really* slept well');
  await expect.poll(() => mdFiles(dir).length && savedText(dir)).toBe('## Morning\n\nI *really* slept well');
  await page.keyboard.press(`${mod}+o`);
  await expect(page.locator('#sidebar .preview')).toHaveText(['Morning']);
});

// --- AC7: no formatting UI -------------------------------------------------------------

test('#14 AC7: selecting text shows no toolbar or popup', async ({ page }) => {
  await page.keyboard.type('Some words to select');
  const visibleOutsideEditor = () => page.evaluate(() =>
    [...document.body.querySelectorAll('*')].filter((el) =>
      !el.closest('#page') && !el.closest('#controls') &&
      el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && el.getClientRects().length > 0
    ).length
  );

  await page.keyboard.press('Shift+Home');
  await page.waitForTimeout(300);
  expect(await visibleOutsideEditor()).toBe(0);

  await editor(page).locator('p').dblclick();
  await page.waitForTimeout(300);
  expect(await visibleOutsideEditor()).toBe(0);
  await expect(page.locator('.milkdown-toolbar, .tooltip, [role=toolbar], [role=menu]')).toHaveCount(0);
});
