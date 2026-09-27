import { $prose, $useKeymap } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/kit/prose/state';

const STARTER = 'Today I ';

/** Nothing on the page at all: one empty paragraph. */
const isEmpty = (doc) => doc.childCount === 1 && doc.firstChild.type.name === 'paragraph' && doc.firstChild.content.size === 0;

/** Marks the empty editor, so CSS can draw the "Today I ..." placeholder. */
const emptyClass = $prose(() => new Plugin({
  props: { attributes: (state) => (isEmpty(state.doc) ? { class: 'empty' } : {}) },
}));

/**
 * Tab on an empty page writes the starter. Lists and tables handle Tab first (their keymaps have the
 * default priority, 50); anywhere else Tab does nothing, rather than moving focus out of the editor.
 */
const tabStarts = $useKeymap('starter', {
  StartWriting: {
    shortcuts: 'Tab',
    priority: 0,
    command: () => (state, dispatch) => {
      if (isEmpty(state.doc)) dispatch?.(state.tr.insertText(STARTER).scrollIntoView());
      return true;
    },
  },
  KeepFocus: { shortcuts: 'Shift-Tab', priority: 0, command: () => () => true },
});

export const starter = [emptyClass, tabStarts].flat();
