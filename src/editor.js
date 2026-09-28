import { Editor, rootCtx, editorViewOptionsCtx, editorViewCtx, serializerCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import {
  commonmark, codeBlockSchema, listItemSchema, bulletListSchema, imageSchema, headingSchema, paragraphSchema, blockquoteSchema,
} from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { $prose, $inputRule, $view, replaceAll } from '@milkdown/kit/utils';
import { Plugin, Selection, TextSelection } from '@milkdown/kit/prose/state';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { findWrapping, liftTarget } from '@milkdown/kit/prose/transform';
import { keymap } from '@milkdown/kit/prose/keymap';
import { chainCommands } from '@milkdown/kit/prose/commands';
import { liftListItem } from '@milkdown/kit/prose/schema-list';
import { slashMenu } from './slash-menu.js';
import { tables } from './tables.js';
import { starter } from './starter.js';

// --- Checklists -------------------------------------------------------------------

/** `[ ] ` / `[x] ` on a plain line starts a checklist (the gfm preset only handles it inside a list). */
const checklistInputRule = $inputRule((ctx) => new InputRule(/^\[( |x)\]\s$/, (state, match, start, end) => {
  const $start = state.doc.resolve(start);
  if ($start.node(-1)?.type === listItemSchema.type(ctx)) return null;
  const tr = state.tr.delete(start, end);
  const range = tr.doc.resolve(start).blockRange();
  const wrapping = range && findWrapping(range, bulletListSchema.type(ctx));
  if (!wrapping) return null;
  tr.wrap(range, wrapping);
  return tr.setNodeAttribute(range.start + 1, 'checked', match[1] === 'x');
}));

/** Renders checklist items with a real, clickable checkbox. */
const listItemView = $view(listItemSchema.node, () => (node, view, getPos) => {
  const dom = document.createElement('li');
  if (node.attrs.checked == null) return { dom, contentDOM: dom };

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = node.attrs.checked;
  box.contentEditable = 'false';
  box.addEventListener('mousedown', (event) => event.preventDefault()); // keep the caret where it is
  box.addEventListener('click', () => {
    view.dispatch(view.state.tr.setNodeAttribute(getPos(), 'checked', !node.attrs.checked));
  });
  const contentDOM = document.createElement('div');
  dom.className = 'task';
  dom.append(box, contentDOM);
  return {
    dom,
    contentDOM,
    update(updated) {
      if (updated.type !== node.type || (updated.attrs.checked == null) !== (node.attrs.checked == null)) return false;
      node = updated;
      box.checked = node.attrs.checked;
      return true;
    },
    ignoreMutation: (mutation) => mutation.target === box,
    stopEvent: (event) => event.target === box,
  };
});

// --- Backspace --------------------------------------------------------------------

const caretAtBlockStart = ({ selection: { $from, empty } }) => empty && $from.parentOffset === 0;

/** In an empty list item, makes it a plain line in place, splitting the list if items follow. */
const emptyItemToParagraph = (ctx) => (state, dispatch) => {
  const { $from } = state.selection;
  const item = $from.node(-1);
  if (!caretAtBlockStart(state) || $from.parent.content.size > 0 || item?.type !== listItemSchema.type(ctx) || item.childCount !== 1) return false;
  return liftListItem(listItemSchema.type(ctx))(state, dispatch);
};

/** On an empty line between two lists of the same kind, removes it and joins the lists; the caret goes to the end of the one above. */
const joinListsAroundEmptyLine = (ctx) => (state, dispatch) => {
  const { $from } = state.selection;
  if (!caretAtBlockStart(state) || $from.parent.content.size > 0) return false;
  const above = state.doc.resolve($from.before()).nodeBefore;
  const below = state.doc.resolve($from.after()).nodeAfter;
  if (above?.firstChild?.type !== listItemSchema.type(ctx) || above.type !== below?.type) return false;
  const tr = state.tr.delete($from.before(), $from.after()).join($from.before());
  dispatch?.(tr.setSelection(Selection.near(tr.doc.resolve($from.before()), -1)).scrollIntoView());
  return true;
};

/** At the start of a heading, makes it a normal line (instead of merging or dropping a level). */
const headingToParagraph = (ctx) => (state, dispatch) => {
  const { $from } = state.selection;
  if (!caretAtBlockStart(state) || $from.parent.type !== headingSchema.type(ctx)) return false;
  dispatch?.(state.tr.setBlockType($from.before(), $from.after(), paragraphSchema.type(ctx)));
  return true;
};

/** At the start of a quote line, moves just that line out of the quote. */
const liftOutOfQuote = (ctx) => (state, dispatch) => {
  const { $from } = state.selection;
  if (!caretAtBlockStart(state) || $from.node(-1)?.type !== blockquoteSchema.type(ctx)) return false;
  const range = $from.blockRange();
  const target = range && liftTarget(range);
  if (target == null) return false;
  dispatch?.(state.tr.lift(range, target).scrollIntoView());
  return true;
};

/** Backspace overrides; used before the presets so these win over their Backspace bindings. */
const backspace = $prose((ctx) => keymap({
  Backspace: chainCommands(emptyItemToParagraph(ctx), joinListsAroundEmptyLine(ctx), headingToParagraph(ctx), liftOutOfQuote(ctx)),
}));

// --- Images -----------------------------------------------------------------------

/** Images without a title: the preset rejects remark's null title and would write back `""`. */
const untitledImages = imageSchema.extendSchema((prev) => (ctx) => {
  const schema = prev(ctx);
  return {
    ...schema,
    parseMarkdown: {
      ...schema.parseMarkdown,
      runner: (state, node, type) => state.addNode(type, { src: node.url, alt: node.alt ?? '', title: node.title ?? '' }),
    },
    toMarkdown: {
      ...schema.toMarkdown,
      runner: (state, node) => state.addNode('image', undefined, undefined, {
        url: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title || null,
      }),
    },
  };
});

// --- Code blocks ------------------------------------------------------------------

/** ``` then Enter starts a code block (the preset only reacts to ``` then space). */
const codeFenceOnEnter = $prose((ctx) => keymap({
  Enter: (state, dispatch) => {
    const { $from, empty } = state.selection;
    const fence = empty && $from.parent.type.name === 'paragraph' && $from.parent.textContent.match(/^```([a-z]*)$/);
    if (!fence || $from.parentOffset !== $from.parent.content.size) return false;
    const tr = state.tr.delete($from.start(), $from.pos);
    dispatch?.(tr.setBlockType($from.start(), $from.start(), codeBlockSchema.type(ctx), { language: fence[1] }));
    return true;
  },
}));

// --- Links ------------------------------------------------------------------------

/** Ctrl/Cmd+click hands a link to the OS; a plain click just places the caret. */
const linkClicks = (openLink, isMac) => $prose(() => new Plugin({
  props: {
    handleClick(_view, _pos, event) {
      const link = event.target.closest?.('a[href]');
      if (!link || !(isMac ? event.metaKey : event.ctrlKey)) return false;
      openLink(link.getAttribute('href'));
      return true;
    },
  },
}));

// --- Changes ----------------------------------------------------------------------

/** True while the page holds nothing a writer typed: no text and no image, divider or the like. */
function isBlank(doc) {
  let blank = true;
  doc.descendants((node) => {
    if (node.isText ? node.text.trim() : node.isLeaf && node.type.name !== 'hardbreak') blank = false;
    return blank;
  });
  return blank;
}

// Serializing a long page takes tens of milliseconds, so it waits for a pause in typing.
const REPORT_DELAY_MS = 250;

/** Reports the markdown once typing pauses; `flush` reports a pending change right away. */
function changeReporter(onChange) {
  let timer = null;
  let serialize = null;
  const flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    onChange(serialize());
  };
  const plugin = $prose((ctx) => new Plugin({
    view: () => ({
      update(view, prevState) {
        if (view.state.doc.eq(prevState.doc)) return;
        serialize = () => (isBlank(view.state.doc) ? '' : ctx.get(serializerCtx)(view.state.doc).replace(/\n$/, ''));
        clearTimeout(timer);
        timer = setTimeout(flush, REPORT_DELAY_MS);
      },
    }),
  }));
  const discard = () => { clearTimeout(timer); timer = null; };
  return { plugin, flush, discard };
}

// --- Search matches ---------------------------------------------------------------

const NOT_SEPARATOR = '[^\\s\\p{Z}\\p{P}]'; // separators as the search index splits words
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first of `words` in `doc`, whole and in any case, as a document range. */
function findFirstWord(doc, words) {
  const pattern = new RegExp(`(?<!${NOT_SEPARATOR})(${words.map(escapeRegExp).join('|')})(?!${NOT_SEPARATOR})`, 'iu');
  let found = null;
  doc.descendants((node, pos) => {
    if (found || !node.isTextblock) return !found;
    // One character per leaf (image, hard break), so string offsets are document offsets.
    const match = pattern.exec(node.textBetween(0, node.content.size, undefined, '\ufffc'));
    if (match) found = { from: pos + 1 + match.index, to: pos + 1 + match.index + match[0].length };
    return false;
  });
  return found;
}

/** Scrolls `scroller` so the line at `pos` sits in its middle. */
function centreOn(view, scroller, pos) {
  const { top, bottom } = view.coordsAtPos(pos);
  scroller.scrollTop += (top + bottom) / 2 - scroller.getBoundingClientRect().top - scroller.clientHeight / 2;
}

const GLOW_MS = 800;

/** A glow over from–to that fades by itself; `scroller` must be positioned so it scrolls along. */
function glow(view, scroller, { from, to }) {
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  // Absolute positions start inside the border and scrollbar gutter.
  const box = scroller.getBoundingClientRect();
  const origin = { left: box.left + scroller.clientLeft, top: box.top + scroller.clientTop };
  const el = Object.assign(document.createElement('div'), { className: 'search-glow' });
  Object.assign(el.style, {
    left: `${start.left - origin.left + scroller.scrollLeft}px`,
    top: `${start.top - origin.top + scroller.scrollTop}px`,
    width: `${end.right - start.left}px`,
    height: `${start.bottom - start.top}px`,
  });
  el.style.animationDuration = `${GLOW_MS}ms`;
  // A timer, not animationend: animations stall while the window isn't painting, timers don't.
  setTimeout(() => el.remove(), GLOW_MS);
  scroller.append(el);
}

// --- Editor -----------------------------------------------------------------------

/**
 * Mounts a live-rendered markdown editor in `root`, whose editable element gets id="editor".
 * `onChange` receives the page as markdown, or '' while it is blank.
 */
export async function createEditor(root, { onChange, openLink, isMac }) {
  const changes = changeReporter(onChange);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        attributes: { id: 'editor', spellcheck: 'false', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Write' },
      }));
      // `- item`, `- [ ] task` and `---`, as people write them by hand.
      ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: '-', rule: '-' }));
    })
    .use(slashMenu) // first, so its keys win over the presets' while the menu is open
    .use(tables) // before gfm, whose Tab would otherwise stop at the last cell
    .use(backspace)
    .use(commonmark)
    .use(untitledImages)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use([checklistInputRule, listItemView, codeFenceOnEnter, linkClicks(openLink, isMac), changes.plugin].flat())
    .use(starter)
    .create();

  const view = editor.ctx.get(editorViewCtx);

  return {
    view,
    flush: changes.flush,
    /** Shows `markdown` with the caret at the end, without reporting it as an edit. Flush first. */
    load(markdown) {
      editor.action(replaceAll(markdown, true));
      changes.discard();
      view.focus(); // first: scrolling into view follows the DOM selection, which is stale until focused
      view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).scrollIntoView());
    },
    /** Puts the caret, selecting nothing, before the first of `words`, centres its line and makes it glow. */
    revealMatch(words) {
      const match = findFirstWord(view.state.doc, words);
      if (!match) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from)));
      centreOn(view, root, match.from);
      glow(view, root, match);
    },
  };
}
