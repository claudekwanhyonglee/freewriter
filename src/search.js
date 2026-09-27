const fs = require('fs');
const path = require('path');
const MiniSearch = require('minisearch');
const { sessionLabel, plainText } = require('./sessions');

const BUILD_CHUNK = 100;
// Listing thousands of matches for a query like "a" would take well over the 100 ms a keystroke may.
const MAX_RESULTS = 100;
const tokenize = MiniSearch.getDefault('tokenize');

const plainLines = (markdown) => markdown.split('\n').map(plainText);

function firstLineWith(terms, lines) {
  const wanted = new Set(terms);
  return lines.find((line) => tokenize(line.toLowerCase()).some((word) => wanted.has(word))) ?? '';
}

/**
 * Full-text search over the sessions in `dir`. The index builds in the background, a chunk at a
 * time so the app stays responsive, and `update` keeps it current as sessions are saved.
 */
function sessionSearch(dir) {
  const index = new MiniSearch({ fields: ['text'] });
  const texts = new Map(); // name → the plain text indexed for it, needed to remove it again

  function remove(name) {
    if (!texts.has(name)) return;
    index.remove({ id: name, text: texts.get(name) });
    texts.delete(name);
  }

  function update(name, markdown) {
    const text = plainLines(markdown).join('\n');
    if (texts.get(name) === text) return;
    remove(name);
    texts.set(name, text);
    index.add({ id: name, text });
  }

  async function build() {
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.md')) : [];
    for (let i = 0; i < names.length; i += BUILD_CHUNK) {
      const chunk = names.slice(i, i + BUILD_CHUNK);
      const markdowns = await Promise.all(chunk.map((name) => fs.promises.readFile(path.join(dir, name), 'utf8').catch(() => null)));
      chunk.forEach((name, j) => {
        // A save or delete during the build already knows better than what was read.
        if (markdowns[j] !== null && !texts.has(name)) update(name, markdowns[j]);
      });
      await new Promise(setImmediate);
    }
  }
  const ready = build();

  // ponytail: peeks at MiniSearch's private term tree; MiniSearch has no public "is this a known word".
  const isKnown = (term) => !index._index.atPrefix(term).keys().next().done;

  /**
   * The best MAX_RESULTS sessions holding every word of `query`, best first. A word some session has, whole or as the
   * start of a longer word, matches just that; any other word is a typo and matches words 1 letter
   * off, 2 for words of 8+ letters.
   */
  async function search(query) {
    await ready;
    const results = index.search(query, {
      combineWith: 'AND',
      prefix: isKnown,
      fuzzy: (term) => !isKnown(term) && (term.length >= 8 ? 2 : 1),
    });
    return results.slice(0, MAX_RESULTS).map(({ id: name, terms }) => ({
      name,
      label: sessionLabel(name),
      firstLine: firstLineWith(terms, texts.get(name).split('\n')),
      terms,
    }));
  }

  return { update, remove, search };
}

module.exports = { sessionSearch };
