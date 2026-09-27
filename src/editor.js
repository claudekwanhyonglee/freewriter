import { Editor, rootCtx, editorViewOptionsCtx, editorViewCtx, serializerCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { commonmark, codeBlockSchema, listItemSchema, bulletListSchema, imageSchema } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { $prose, $inputRule, $view, replaceAll } from '@milkdown/kit/utils';
import { Plugin, Selection } from '@milkdown/kit/prose/state';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { findWrapping } from '@milkdown/kit/prose/transform';
import { keymap } from '@milkdown/kit/prose/keymap';
import { slashMenu } from './slash-menu.js';

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
    .use(commonmark)
    .use(untitledImages)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use([checklistInputRule, listItemView, codeFenceOnEnter, linkClicks(openLink, isMac), changes.plugin].flat())
    .create();

  const view = editor.ctx.get(editorViewCtx);

  return {
    view,
    flush: changes.flush,
    /** Shows `markdown` with the caret at the end, without reporting it as an edit. Flush first. */
    load(markdown) {
      editor.action(replaceAll(markdown, true));
      changes.discard();
      view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).scrollIntoView());
      view.focus();
    },
  };
}
