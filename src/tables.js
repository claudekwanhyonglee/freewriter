import { tableSchema, tableHeaderRowSchema, tableRowSchema, tableHeaderSchema, tableCellSchema } from '@milkdown/kit/preset/gfm';
import { $prose } from '@milkdown/kit/utils';
import { Plugin, Selection, TextSelection } from '@milkdown/kit/prose/state';
import { keymap } from '@milkdown/kit/prose/keymap';

// --- Editing a table as a grid of cells ------------------------------------------------

/** A table node as rows of cell nodes; the first row is the header. */
const toGrid = (table) => {
  const grid = [];
  table.forEach((row) => {
    const cells = [];
    row.forEach((cell) => cells.push(cell));
    grid.push(cells);
  });
  return grid;
};

/** Builds a table from a grid; a GFM table needs a header row and at least one row and column below it. */
function fromGrid(ctx, grid) {
  if (grid.length < 2 || grid[0].length < 1) return null;
  const retype = (cell, type) => type.create(cell.attrs, cell.content);
  const header = tableHeaderRowSchema.type(ctx).create(null, grid[0].map((cell) => retype(cell, tableHeaderSchema.type(ctx))));
  const body = grid.slice(1).map((cells) => tableRowSchema.type(ctx).create(null, cells.map((cell) => retype(cell, tableCellSchema.type(ctx)))));
  return tableSchema.type(ctx).create(null, [header, ...body]);
}

// No alignment unless the neighbouring cell has one, so the markdown is a plain `| --- |`.
const emptyCell = (ctx, like) => tableCellSchema.type(ctx).createAndFill({ alignment: like?.attrs.alignment ?? null });

const gridEdits = {
  addRow: (ctx, grid) => [...grid, grid[0].map((cell) => emptyCell(ctx, cell))],
  addColumn: (ctx, grid) => grid.map((cells) => [...cells, emptyCell(ctx, cells.at(-1))]),
  removeRow: (_ctx, grid, { row }) => grid.filter((_, index) => index !== row),
  removeColumn: (_ctx, grid, { col }) => grid.map((cells) => cells.filter((_, index) => index !== col)),
};

/** Position just inside cell (row, col) of the table starting at tablePos. */
function cellStart(table, tablePos, row, col) {
  let pos = tablePos + 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  pos += 1;
  for (let c = 0; c < col; c++) pos += table.child(row).child(c).nodeSize;
  return pos + 1;
}

/**
 * Applies a grid edit to the table at tablePos; removing the last row or column removes the table.
 * The caret lands in cell `caret` ([row, col]) of the result.
 */
function editTable(view, ctx, tablePos, edit, target = {}, caret = null) {
  const { state } = view;
  const table = state.doc.nodeAt(tablePos);
  const edited = fromGrid(ctx, gridEdits[edit](ctx, toGrid(table), target));
  const tr = edited
    ? state.tr.replaceWith(tablePos, tablePos + table.nodeSize, edited)
    : state.tr.delete(tablePos, tablePos + table.nodeSize);
  if (edited && caret) tr.setSelection(TextSelection.near(tr.doc.resolve(cellStart(edited, tablePos, ...caret) + 1)));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Inserts a 2×2 table (header row plus one row) with the caret in its first cell. */
export function insertTable(ctx, view) {
  const empty = () => emptyCell(ctx, null);
  const table = fromGrid(ctx, [[empty(), empty()], [empty(), empty()]]);
  const { from } = view.state.selection;
  const tr = view.state.tr.replaceSelectionWith(table);
  view.dispatch(tr.setSelection(Selection.findFrom(tr.doc.resolve(from), 1, true)).scrollIntoView());
}

// --- Tab in the last cell ------------------------------------------------------------------

/** Where the caret is in a table: the table's position, and the cell's row and column. */
function caretCell(state) {
  const { $head } = state.selection;
  for (let depth = $head.depth; depth > 2; depth--) {
    if ($head.node(depth - 2).type.name !== 'table') continue;
    return { tablePos: $head.before(depth - 2), table: $head.node(depth - 2), row: $head.index(depth - 2), col: $head.index(depth - 1) };
  }
  return null;
}

const tabInLastCell = (ctx) => (state, dispatch, view) => {
  const at = caretCell(state);
  if (!at || at.row !== at.table.childCount - 1 || at.col !== at.table.child(at.row).childCount - 1) return false;
  editTable(view, ctx, at.tablePos, 'addRow', {}, [at.row + 1, 0]);
  return true;
};

// --- Hover handles --------------------------------------------------------------------------

const REACH_PX = 28; // how far outside the table the pointer can go and still reach its handles
const HANDLES = [
  { edit: 'addColumn', label: 'Add column', text: '+' },
  { edit: 'addRow', label: 'Add row', text: '+' },
  { edit: 'removeRow', label: 'Remove row', text: '×' },
  { edit: 'removeColumn', label: 'Remove column', text: '×' },
];

const within = (rect, x, y, margin = 0) =>
  x >= rect.left - margin && x <= rect.right + margin && y >= rect.top - margin && y <= rect.bottom + margin;

/** Small +/× buttons around the table under the pointer. */
class TableHandles {
  constructor(view, ctx) {
    this.view = view;
    this.ctx = ctx;
    this.target = null; // { table: HTMLTableElement, row, col }
    this.buttons = Object.fromEntries(HANDLES.map(({ edit, label, text }) => {
      const button = Object.assign(document.createElement('button'), { className: 'table-handle', textContent: text, hidden: true });
      button.setAttribute('aria-label', label);
      button.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus in the editor
      button.addEventListener('click', () => this.apply(edit));
      document.body.append(button);
      return [edit, button];
    }));
    this.pointer = { x: -1, y: -1 };
    this.onMouseMove = (event) => {
      this.pointer = { x: event.clientX, y: event.clientY };
      this.follow(event.clientX, event.clientY);
    };
    this.onScroll = () => this.hide();
    document.addEventListener('mousemove', this.onMouseMove);
    view.dom.addEventListener('scroll', this.onScroll);
  }

  follow(x, y) {
    const table = [...this.view.dom.querySelectorAll('table')].find((t) => within(t.getBoundingClientRect(), x, y, REACH_PX));
    if (!table) return this.hide();
    const rows = [...table.rows];
    const row = rows.findIndex((r) => y >= r.getBoundingClientRect().top && y <= r.getBoundingClientRect().bottom);
    const col = [...rows[0].cells].findIndex((c) => x >= c.getBoundingClientRect().left && x <= c.getBoundingClientRect().right);
    // Keep the last row/column while the pointer is off to the side, on its handle.
    this.target = {
      table,
      row: row >= 0 ? row : (this.target?.table === table ? this.target.row : -1),
      col: col >= 0 ? col : (this.target?.table === table ? this.target.col : -1),
    };
    this.place();
  }

  place() {
    const { table, row, col } = this.target;
    const box = table.getBoundingClientRect();
    const size = this.buttons.addRow.offsetHeight || 18;
    const put = (button, left, top) => {
      button.hidden = false;
      Object.assign(button.style, { left: `${left}px`, top: `${top}px` });
    };
    put(this.buttons.addColumn, box.right + 4, box.top + box.height / 2 - size / 2);
    put(this.buttons.addRow, box.left + box.width / 2 - size / 2, box.bottom + 4);

    this.buttons.removeRow.hidden = row < 0;
    if (row >= 0) {
      const r = table.rows[row].getBoundingClientRect();
      put(this.buttons.removeRow, box.left - size - 4, r.top + r.height / 2 - size / 2);
    }
    this.buttons.removeColumn.hidden = col < 0;
    if (col >= 0) {
      const c = table.rows[0].cells[col].getBoundingClientRect();
      put(this.buttons.removeColumn, c.left + c.width / 2 - size / 2, box.top - size - 4);
    }
  }

  hide() {
    this.target = null;
    for (const button of Object.values(this.buttons)) button.hidden = true;
  }

  apply(edit) {
    const { table, row, col } = this.target;
    const $inCell = this.view.state.doc.resolve(this.view.posAtDOM(table.rows[0].cells[0], 0));
    const tablePos = $inCell.before([...Array($inCell.depth + 1).keys()].findLast((d) => $inCell.node(d).type.name === 'table'));
    const caret = { addRow: [table.rows.length, 0], addColumn: [Math.max(row, 0), table.rows[0].cells.length] }[edit];
    editTable(this.view, this.ctx, tablePos, edit, { row, col }, caret);
  }

  /** After any edit the table may have moved, grown or gone: find it again under the pointer. */
  update() {
    if (this.target) this.follow(this.pointer.x, this.pointer.y);
  }

  destroy() {
    document.removeEventListener('mousemove', this.onMouseMove);
    this.view.dom.removeEventListener('scroll', this.onScroll);
    for (const button of Object.values(this.buttons)) button.remove();
  }
}

/** Table extras: hover handles to add and remove rows and columns, and Tab in the last cell adds a row. */
export const tables = [
  $prose((ctx) => keymap({ Tab: tabInLastCell(ctx) })),
  $prose((ctx) => new Plugin({ view: (view) => new TableHandles(view, ctx) })),
];
