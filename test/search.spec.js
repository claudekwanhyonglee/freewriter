const fs = require('fs');
const path = require('path');
const { test, expect, launch, mod, seed, tempDir } = require('./fixture');

const searchBox = (page) => page.locator('#search');
const results = (page) => page.locator('#session-list li');
const previews = (page) => page.locator('#session-list .preview').allTextContents();

async function launchWithDocs(docs) {
  const dir = tempDir('fw-');
  seed(dir, docs);
  const { app, page } = await launch({ dir, userData: tempDir('fw-') });
  await page.keyboard.press(`${mod}+o`);
  return { app, page, dir };
}

/** Searches for `query` and waits for the list to show `expected` previews, in order. */
async function expectSearch(page, query, expected) {
  await searchBox(page).fill(query);
  await expect.poll(() => previews(page)).toEqual(expected);
}

test('#33 AC1: the sidebar has a search box that filters on every keystroke', async () => {
  const { app, page } = await launchWithDocs({
    '2025-01-01 08-00-00.md': 'zebra crossing',
    '2025-01-02 08-00-00.md': 'zeal and zest',
    '2025-01-03 08-00-00.md': 'apple pie',
  });
  await expect(searchBox(page)).toBeVisible();
  await searchBox(page).click();
  await page.keyboard.type('z');
  await expect(results(page)).toHaveCount(2);
  await page.keyboard.type('e');
  await expect(results(page)).toHaveCount(2);
  await page.keyboard.type('b');
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toContainText('zebra crossing');
  await app.close();
});

test('#33 AC2: every word must appear, case-insensitive, prefixes count, best first', async () => {
  const { app, page } = await launchWithDocs({
    '2025-01-01 08-00-00.md': 'Running in the park today',
    '2025-01-02 08-00-00.md': 'The park was quiet today',
    '2025-01-03 08-00-00.md': 'running running running park',
    '2025-01-04 08-00-00.md': 'running on the beach',
  });
  await expectSearch(page, 'RUN Park', ['running running running park', 'Running in the park today']);
  await app.close();
});

test('#33 AC3: a word some doc contains matches only itself and longer words it starts', async () => {
  const { app, page } = await launchWithDocs({
    '2025-01-01 08-00-00.md': 'my car is red',
    '2025-01-02 08-00-00.md': 'the cat sleeps',
    '2025-01-03 08-00-00.md': 'a cartoon cat',
  });
  await expectSearch(page, 'car', ['my car is red', 'a cartoon cat']);
  await app.close();
});

test('#33 AC4: a word no doc contains is a typo: 1 letter off, 2 for words of 8+ letters', async () => {
  const { app, page } = await launchWithDocs({
    '2025-01-01 08-00-00.md': 'the cat sleeps',
    '2025-01-02 08-00-00.md': 'I definitely agree',
    '2025-01-03 08-00-00.md': 'a good example',
  });
  await expectSearch(page, 'caq', ['the cat sleeps']);
  await expectSearch(page, 'definately', ['I definitely agree']);
  await expectSearch(page, 'definatly', ['I definitely agree']); // 2 letters off, 9 letters long
  await expectSearch(page, 'exampel', []); // 2 letters off, only 7 long
  await app.close();
});

test('#33 AC5: each result shows its date and the first line with a match', async () => {
  const { app, page } = await launchWithDocs({
    '2025-03-04 18-30-00.md': '# A title\n\nSecond line with a **zebra**\n\nzebra again',
  });
  await expectSearch(page, 'zebra', ['Second line with a zebra']);
  await expect(results(page).locator('.date')).toHaveText('2025-03-04 18:30');
  await expect(results(page).locator('.preview')).toHaveText('Second line with a zebra');
  await app.close();
});

test('#33 AC6: clearing the search box restores the newest-first list', async () => {
  const { app, page } = await launchWithDocs({
    '2025-01-01 08-00-00.md': 'Oldest zebra',
    '2025-01-02 08-00-00.md': 'Middle',
    '2025-01-03 08-00-00.md': 'Newest',
  });
  await expectSearch(page, 'zebra', ['Oldest zebra']);
  await expectSearch(page, '', ['Newest', 'Middle', 'Oldest zebra']);
  await app.close();
});

test('#33 AC7: text just written is searchable once autosaved, without reopening the sidebar', async () => {
  const { app, page, dir } = await launchWithDocs({ '2025-01-01 08-00-00.md': 'An old note' });
  await page.keyboard.type('A quokka smiled');
  await expect(page.locator('#editor')).toHaveText('A quokka smiled');
  await expect.poll(() => fs.readdirSync(dir).length).toBe(2);
  const fresh = fs.readdirSync(dir).find((f) => !f.startsWith('2025'));
  await expect.poll(() => fs.readFileSync(path.join(dir, fresh), 'utf8')).toBe('A quokka smiled');
  await expectSearch(page, 'quokka', ['A quokka smiled']);
  await app.close();
});

// --- AC8: speed --------------------------------------------------------------------

/** A deterministic pseudo-random generator, so the corpus is the same every run. */
function random(seedValue) {
  let s = seedValue;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

function corpus(dir, { docs, words }) {
  const rand = random(42);
  const syllables = ['ka', 'lo', 'mi', 'ne', 'ru', 'ta', 'shi', 'ven', 'dor', 'pa', 'qui', 'zel', 'bra', 'ton', 'e', 'a'];
  const vocabulary = Array.from({ length: 20000 }, () => {
    const n = 1 + Math.floor(rand() * 4);
    return Array.from({ length: n }, () => syllables[Math.floor(rand() * syllables.length)]).join('');
  });
  // Skewed like real text: a few words are very common, most are rare.
  const word = () => vocabulary[Math.floor(vocabulary.length * rand() ** 3)];
  for (let d = 0; d < docs; d++) {
    const lines = Array.from({ length: words / 10 }, () => Array.from({ length: 10 }, word).join(' '));
    const date = new Date(2020, 0, 1, 0, 0, d);
    const pad = (n) => String(n).padStart(2, '0');
    const name = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.md`;
    fs.writeFileSync(path.join(dir, name), lines.join('\n\n'));
  }
  fs.writeFileSync(path.join(dir, '2019-12-31 23-59-59.md'), 'sentinel');
}

/** Types `query` into the search box one key at a time; resolves to each keystroke's ms until the list updated. */
const keystrokeLatencies = (page, query) => page.evaluate(async (query) => {
  const box = document.getElementById('search');
  const list = document.getElementById('session-list');
  const latencies = [];
  box.value = '';
  for (const char of query) {
    const started = performance.now();
    const updated = new Promise((resolve) => {
      const observer = new MutationObserver(() => { observer.disconnect(); resolve(); });
      observer.observe(list, { childList: true });
    });
    box.value += char;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await updated;
    latencies.push(performance.now() - started);
  }
  return latencies;
}, query);

test('#33 AC8: with 2,000 docs of 1,000 words, results appear within 100 ms of a keystroke', async () => {
  test.setTimeout(180000);
  const dir = tempDir('fw-');
  corpus(dir, { docs: 2000, words: 1000 });
  const { app, page } = await launch({ dir, userData: tempDir('fw-') });
  await page.keyboard.press(`${mod}+o`);
  // Warm-up: the first answer waits for the startup index.
  await searchBox(page).fill('sentinel');
  await expect(results(page)).toHaveCount(1, { timeout: 60000 });

  const latencies = [];
  for (const query of ['a', 'kalo', 'mine ruta', 'kalotaq', 'shiventon', 'e ka lo']) {
    latencies.push(...await keystrokeLatencies(page, query));
  }
  console.log('keystroke latencies (ms):', latencies.map(Math.round).join(' '));
  expect(Math.max(...latencies)).toBeLessThan(100);
  await app.close();
});

test('#33 AC8: only the best 100 matches are listed, so results stay fast', async () => {
  const docs = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`2025-01-01 08-${String(Math.floor(i / 60)).padStart(2, '0')}-${String(i % 60).padStart(2, '0')}.md`, `zebra ${i}`]));
  docs['2024-01-01 08-00-00.md'] = 'zebra zebra zebra'; // the best match, though the oldest
  const { app, page } = await launchWithDocs(docs);
  await searchBox(page).fill('zebra');
  await expect(results(page)).toHaveCount(100);
  await expect(results(page).first()).toContainText('zebra zebra zebra');
  await app.close();
});

// --- AC9–10: opening a result ------------------------------------------------------

const paragraphs = (count, extra) => Array.from({ length: count }, (_, i) => extra[i] ?? `Paragraph ${i}`).join('\n\n');

/** Where the caret is, whether anything is selected, and how far the caret's line is from the window's middle. */
const caret = (page) => page.evaluate(() => {
  const selection = getSelection();
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return {
    textAfter: selection.anchorNode.textContent.slice(selection.anchorOffset),
    collapsed: selection.isCollapsed,
    offCentre: Math.abs((rect.top + rect.bottom) / 2 - innerHeight / 2),
    lineHeight: rect.height,
  };
});

for (const [where, at] of [['mid-doc', 40], ['on the last line', 59]]) {
  test(`#33 AC9: opening a result ${where} keeps the sidebar, puts the caret at the first match, centred, nothing selected`, async () => {
    const { app, page } = await launchWithDocs({
      '2025-01-01 08-00-00.md': paragraphs(60, { [at]: `Here is the Needle, and another needle` }),
    });
    await expectSearch(page, 'needle', [expect.stringContaining('eedle')]);
    await results(page).first().click();
    await expect(page.locator('#editor')).toBeFocused();
    await expect(page.locator('#sidebar')).toBeVisible();
    const { textAfter, collapsed, offCentre, lineHeight } = await caret(page);
    expect(textAfter.startsWith('Needle, and another')).toBe(true);
    expect(collapsed).toBe(true);
    expect(offCentre).toBeLessThanOrEqual(lineHeight);
    await app.close();
  });
}

test('#33 AC10: a glow appears over the match when a result opens and is gone within 1 s', async () => {
  const { app, page } = await launchWithDocs({
    '2025-01-01 08-00-00.md': paragraphs(30, { 20: 'Here is the needle' }),
  });
  await expectSearch(page, 'needle', [expect.stringContaining('eedle')]);
  await results(page).first().click();
  const glow = page.locator('.search-glow');
  await expect(glow).toHaveCount(1);
  const opened = Date.now();

  const { glowBox, matchBox } = await page.evaluate(() => {
    const text = [...document.querySelectorAll('#editor p')].find((p) => p.textContent.includes('needle')).firstChild;
    const range = document.createRange();
    const start = text.textContent.indexOf('needle');
    range.setStart(text, start);
    range.setEnd(text, start + 'needle'.length);
    return {
      glowBox: document.querySelector('.search-glow').getBoundingClientRect().toJSON(),
      matchBox: range.getBoundingClientRect().toJSON(),
    };
  });
  const centre = (box) => [box.left + box.width / 2, box.top + box.height / 2];
  const [gx, gy] = centre(glowBox);
  const [mx, my] = centre(matchBox);
  expect(Math.abs(gx - mx)).toBeLessThan(4);
  expect(Math.abs(gy - my)).toBeLessThan(4);
  expect(glowBox.width).toBeGreaterThanOrEqual(matchBox.width - 1);

  await expect(glow).toHaveCount(0, { timeout: 1000 - (Date.now() - opened) });
  await app.close();
});
