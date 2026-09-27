import { commandsCtx } from '@milkdown/kit/core';
import {
  wrapInHeadingCommand, wrapInBulletListCommand, wrapInOrderedListCommand,
  wrapInBlockquoteCommand, insertHrCommand, createCodeBlockCommand, listItemSchema,
} from '@milkdown/kit/preset/commonmark';
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { insertTable } from './tables.js';

const call = (command, payload) => (ctx) => ctx.get(commandsCtx).call(command.key, payload);

function checklist(ctx, view) {
  call(wrapInBulletListCommand)(ctx);
  const { $head } = view.state.selection;
  for (let depth = $head.depth; depth > 0; depth--) {
    if ($head.node(depth).type !== listItemSchema.type(ctx)) continue;
    view.dispatch(view.state.tr.setNodeAttribute($head.before(depth), 'checked', false));
    return;
  }
}

const ITEMS = [
  { label: 'Table', run: insertTable },
  { label: 'Heading 1', run: call(wrapInHeadingCommand, 1) },
  { label: 'Heading 2', run: call(wrapInHeadingCommand, 2) },
  { label: 'Heading 3', run: call(wrapInHeadingCommand, 3) },
  { label: 'Bullet list', run: call(wrapInBulletListCommand) },
  { label: 'Numbered list', run: call(wrapInOrderedListCommand) },
  { label: 'Checklist', run: checklist },
  { label: 'Quote', run: call(wrapInBlockquoteCommand) },
  { label: 'Divider', run: call(insertHrCommand) },
  { label: 'Code block', run: call(createCodeBlockCommand) },
];

const matching = (query) => ITEMS.filter(({ label }) => label.toLowerCase().replace(/\s/g, '').includes(query.toLowerCase()));

const key = new PluginKey('slash-menu');

/**
 * Where the open menu's `/` is, and what was typed after it; null while closed.
 * It stays open only while the caret sits right after an unbroken `/query` in the same block.
 */
const menuState = {
  init: () => null,
  apply(tr, open, _oldState, state) {
    const meta = tr.getMeta(key);
    if (meta !== undefined) return meta;
    if (!open) return null;
    const slash = tr.mapping.map(open.slash, -1);
    const { $head, empty } = state.selection;
    if (!empty || $head.pos <= slash || slash < $head.start()) return null;
    const typed = state.doc.textBetween(slash, $head.pos);
    return /^\/\S*$/.test(typed) ? { slash, query: typed.slice(1) } : null;
  },
};

/** A `/` typed at the start of a block or after whitespace opens the menu. */
function openOnSlash(view, from, to, text) {
  if (text !== '/') return false;
  const $from = view.state.doc.resolve(from);
  const before = $from.parent.textBetween(0, $from.parentOffset);
  if (before && !/\s$/.test(before)) return false;
  view.dispatch(view.state.tr.insertText('/', from, to).setMeta(key, { slash: from, query: '' }));
  return true;
}

/** The list of blocks, drawn under the caret while the menu is open. */
class MenuView {
  constructor(view, ctx) {
    this.view = view;
    this.ctx = ctx;
    this.highlighted = 0;
    this.items = [];
    this.list = Object.assign(document.createElement('ul'), { id: 'slash-menu', hidden: true });
    this.list.setAttribute('role', 'listbox');
    this.list.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus in the editor
    document.body.append(this.list);
    this.update(view, null);
  }

  update(view, previous) {
    const open = key.getState(view.state);
    if (previous && open?.query !== key.getState(previous)?.query) this.highlighted = 0;
    this.items = open ? matching(open.query) : [];
    this.list.hidden = this.items.length === 0;
    if (this.list.hidden) return;

    this.list.replaceChildren(...this.items.map((item, index) => {
      const option = Object.assign(document.createElement('li'), { textContent: item.label });
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === this.highlighted));
      option.addEventListener('click', () => this.choose(item));
      return option;
    }));
    const caret = view.coordsAtPos(open.slash);
    this.list.style.left = `${caret.left}px`;
    this.list.style.top = `${caret.bottom + 4}px`;
  }

  get isShown() {
    return !this.list.hidden;
  }

  move(step) {
    this.highlighted = (this.highlighted + step + this.items.length) % this.items.length;
    this.update(this.view, null);
  }

  close() {
    this.view.dispatch(this.view.state.tr.setMeta(key, null));
  }

  choose(item = this.items[this.highlighted]) {
    const { slash } = key.getState(this.view.state);
    const { state } = this.view;
    this.view.dispatch(state.tr.delete(slash, state.selection.head).setMeta(key, null));
    item.run(this.ctx, this.view);
    this.view.focus();
  }

  destroy() {
    this.list.remove();
  }
}

/** Typing `/` offers a small menu of blocks to insert, for writers who don't know the markdown for them. */
export const slashMenu = $prose((ctx) => {
  let menu;
  const keys = {
    ArrowDown: () => menu.move(1),
    ArrowUp: () => menu.move(-1),
    Enter: () => menu.choose(),
    Escape: () => menu.close(),
  };
  return new Plugin({
    key,
    state: menuState,
    view: (view) => (menu = new MenuView(view, ctx)),
    props: {
      handleTextInput: openOnSlash,
      handleKeyDown(_view, event) {
        const action = menu.isShown && keys[event.key];
        if (!action) return false;
        action();
        return true;
      },
    },
  });
});
