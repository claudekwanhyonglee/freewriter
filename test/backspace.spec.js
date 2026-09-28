const fs = require('fs');
const { test, expect, launchWithSession } = require('./fixture');

const editor = (page) => page.locator('#editor');

/**
 * Puts the caret at the start (or `offset` characters in) of the first line of text beginning with `line`, once the editor has
 * taken it. Set directly: arrow keys faster than any typist overtake the editor's caret.
 * Retried until it stays put: on a slow machine, a session only just opened can still move the
 * caret back to its end (the editor restores its own caret for a moment after gaining focus).
 * Not for the document's first line: the editor always puts a caret set there by script back.
 */
async function caretBefore(page, line, offset = 0) {
  const place = () => page.evaluate(({ line, offset }) => new Promise((done) => {
    document.addEventListener('selectionchange', done, { once: true });
    const walker = document.createTreeWalker(document.getElementById('editor'), NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && !walker.currentNode.data.startsWith(line));
    getSelection().collapse(walker.currentNode, offset);
  }), { line, offset });
  const caret = () => page.evaluate(() => `${getSelection().anchorNode.textContent}@${getSelection().anchorOffset}`);
  await expect(async () => {
    await place();
    await page.waitForTimeout(100); // longer than the editor's put-back after focus (20ms)
    expect(await caret()).toMatch(new RegExp(`^${line}.*@${offset}$`));
  }).toPass({ timeout: 5000 });
}

/** Opens `text`, presses Backspace at the start of `line` and types "X" where the caret lands. */
async function backspaceAt(text, line) {
  const session = await launchWithSession(text);
  await caretBefore(session.page, line);
  await session.page.keyboard.press('Backspace');
  await session.page.keyboard.type('X');
  const saved = () => fs.readFileSync(session.file, 'utf8');
  return { ...session, saved };
}

/**
 * Opens `text`, whose empty item is written as `- EMPTY` (a truly empty task item doesn't parse as
 * one), empties that item, presses Backspace in it and types "X" where the caret lands.
 */
async function backspaceInEmptyItem(text) {
  const session = await launchWithSession(text.replace('EMPTY', 'Z'));
  if (!text.endsWith('EMPTY')) await caretBefore(session.page, 'Z', 1); // opening puts the caret at the end
  await session.page.keyboard.press('Backspace');
  await session.page.keyboard.press('Backspace');
  await session.page.keyboard.type('X');
  const saved = () => fs.readFileSync(session.file, 'utf8');
  return { ...session, saved };
}

// --- #45: an empty list item becomes a plain line -------------------------------------

for (const { list, text, result } of [
  { list: 'dot point', text: '- one\n- EMPTY', result: '- one\n\nX' },
  { list: 'numbered', text: '1. one\n2. EMPTY', result: '1. one\n\nX' },
  { list: 'checklist', text: '- [ ] one\n- [ ] EMPTY', result: '- [ ] one\n\nX' },
]) {
  const ac = { 'dot point': 'AC1', numbered: 'AC2', checklist: 'AC3' }[list];
  test(`#45 ${ac}: Backspace in an empty ${list} item makes it a plain top-level line in place`, async () => {
    const { app, page, saved } = await backspaceInEmptyItem(text);
    await expect(editor(page).locator('li')).toHaveText(['one']);
    await expect(editor(page).locator('> p')).toHaveText(['X']);
    await expect.poll(saved).toBe(result);
    await app.close();
  });
}

test('#45 AC4: Backspace in an empty middle item leaves a plain line between two lists', async () => {
  const { app, page } = await backspaceInEmptyItem('- one\n- EMPTY\n- two');
  await expect(editor(page).locator('> ul')).toHaveText(['one', 'two']);
  await expect(editor(page).locator('> *')).toHaveText(['one', 'X', 'two']);
  await expect(editor(page).locator('> p')).toHaveText(['X']);
  await app.close();
});

// --- AC1: quote lines ---------------------------------------------------------------

test('#23 AC1: Backspace at the start of the last quote line makes it a normal line; the rest stays quoted', async () => {
  const { app, page, saved } = await backspaceAt('> one\n>\n> two', 'two');
  await expect(editor(page).locator('blockquote')).toHaveText('one');
  await expect(editor(page).locator('> p')).toHaveText(['Xtwo']);
  await expect.poll(saved).toBe('> one\n\nXtwo');
  await app.close();
});

test('#23 AC1: Backspace at the start of the first quote line makes it a normal line; the rest stays quoted', async () => {
  const { app, page, saved } = await backspaceAt('Above\n\n> one\n>\n> two', 'one');
  await expect(editor(page).locator('> p')).toHaveText(['Above', 'Xone']);
  await expect(editor(page).locator('blockquote')).toHaveText('two');
  await expect.poll(saved).toBe('Above\n\nXone\n\n> two');
  await app.close();
});

test('#23 AC1: Backspace at the start of a middle quote line makes it a normal line between two quotes', async () => {
  const { app, page } = await backspaceAt('> one\n>\n> two\n>\n> three', 'two');
  await expect(editor(page).locator('blockquote')).toHaveText(['one', 'three']);
  await expect(editor(page).locator('> p')).toHaveText(['Xtwo']);
  await app.close();
});

// --- AC2: empty quote ---------------------------------------------------------------

test('#23 AC2: Backspace in an empty quote removes the quote, leaving an empty normal line', async ({ page }) => {
  await page.keyboard.type('> ');
  await expect(editor(page).locator('blockquote')).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect(editor(page).locator('blockquote')).toHaveCount(0);
  await expect(editor(page).locator('> p')).toHaveText(['']);
  await page.keyboard.type('plain');
  await expect(editor(page).locator('> p')).toHaveText(['plain']);
});

// --- AC3: headings ------------------------------------------------------------------

for (const level of [1, 2, 3]) {
  test(`#23 AC3: Backspace at the start of an H${level} makes it a normal line, without merging or changing level`, async () => {
    const { app, page, saved } = await backspaceAt(`Above\n\n${'#'.repeat(level)} Title`, 'Title');
    await expect(editor(page).locator('h1, h2, h3')).toHaveCount(0);
    await expect(editor(page).locator('> p')).toHaveText(['Above', 'XTitle']);
    await expect.poll(saved).toBe('Above\n\nXTitle');
    await app.close();
  });
}

// --- AC4: other blocks keep today's behaviour -----------------------------------------

// What Backspace did before #23: lines and code merge into the block above; list items join the item above.
for (const { block, text, line, result } of [
  { block: 'normal line', text: 'Above\n\nBelow', line: 'Below', result: 'AboveXBelow' },
  { block: 'list item', text: '- one\n- two', line: 'two', result: '- one\n\n  Xtwo' },
  { block: 'numbered list item', text: '1. one\n2. two', line: 'two', result: '1. one\n\n   Xtwo' },
  { block: 'first list item', text: 'Above\n\n- one', line: 'one', result: 'Above\n\nXone' },
  { block: 'code block', text: 'Above\n\n```\ncode\n```', line: 'code', result: 'AboveXcode' },
]) {
  test(`#23 AC4: Backspace at the start of a ${block} works as before`, async () => {
    const { app, saved } = await backspaceAt(text, line);
    await expect.poll(saved).toBe(result);
    await app.close();
  });
}
