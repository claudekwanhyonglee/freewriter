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
  // The words of the last query and what each matched: typing the next letter reuses all but the last word.
  let wordMatches = new Map();

  function remove(name) {
    if (!texts.has(name)) return;
    index.remove({ id: name, text: texts.get(name) });
    texts.delete(name);
    wordMatches = new Map();
  }

  function update(name, markdown) {
    const text = plainLines(markdown).join('\n');
    if (texts.get(name) === text) return;
    remove(name);
    texts.set(name, text);
    index.add({ id: name, text });
    wordMatches = new Map();
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
   * Sessions matching one query word, by name. A word some session has, whole or as the start of a
   * longer word, matches just that; any other word is a typo and matches words 1 letter off, 2 for
   * words of 8+ letters.
   */
  function matchWord(word) {
    const results = index.search(word, {
      prefix: isKnown,
      fuzzy: (term) => !isKnown(term) && (term.length >= 8 ? 2 : 1),
    });
    return new Map(results.map(({ id, score, terms }) => [id, { score, terms }]));
  }

  /**
   * Sessions holding every word, best first: the same ranking as MiniSearch's own AND, whose
   * score is the sum of the words' scores (times the word count, the same for every result).
   */
  function matchAll(words) {
    wordMatches = new Map(words.map((word) => [word, wordMatches.get(word) ?? matchWord(word)]));
    const [fewest, ...others] = [...wordMatches.values()].sort((a, b) => a.size - b.size);
    const results = [];
    for (const [name, { score, terms }] of fewest) {
      const alsoMatched = others.map((matches) => matches.get(name));
      if (alsoMatched.includes(undefined)) continue;
      results.push({
        name,
        score: alsoMatched.reduce((sum, match) => sum + match.score, score),
        terms: [...new Set([terms, ...alsoMatched.map((match) => match.terms)].flat())],
      });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  /** The best MAX_RESULTS sessions holding every word of `query` (see matchWord), best first. */
  async function search(query) {
    await ready;
    const words = [...new Set(tokenize(query.toLowerCase()).filter(Boolean))];
    if (!words.length) return [];
    return matchAll(words).slice(0, MAX_RESULTS).map(({ name, terms }) => ({
      name,
      label: sessionLabel(name),
      firstLine: firstLineWith(terms, texts.get(name).split('\n')),
      terms,
    }));
  }

  return { update, remove, search };
}

module.exports = { sessionSearch };
