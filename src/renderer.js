import { createEditor } from './editor.js';

const api = window.freewriter;
const isMac = api.platform === 'darwin';
const sidebar = document.getElementById('sidebar');
const sessionList = document.getElementById('session-list');
const controls = document.getElementById('controls');

const TEXT_SIZE = { min: 14, max: 40, initial: 22, step: 2 };
const CONTROLS_LINGER_MS = 2000;

// --- Editor -----------------------------------------------------------------

// Relative image paths in a session resolve against the sessions folder, where the session file lives.
const base = Object.assign(document.createElement('base'), { href: api.sessionsDirUrl });
document.head.append(base);

const editor = await createEditor(document.getElementById('page'), { onChange: api.textChanged, openLink: api.openLink, isMac });
const editorElement = editor.view.dom;
const focusEditor = () => editor.view.focus();
const showInEditor = (text) => editor.load(text);
// The main process must hold the latest text before it lists, switches or closes sessions.
const saveNow = editor.flush;
window.addEventListener('beforeunload', saveNow);

// --- Sessions ---------------------------------------------------------------

const TRASH_ICON = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';

function sessionItem({ name, label, firstLine }) {
  const open = document.createElement('button');
  const date = document.createElement('span');
  const preview = document.createElement('span');
  date.className = 'date';
  date.textContent = label;
  preview.className = 'preview';
  preview.textContent = firstLine;
  open.className = 'open';
  open.append(date, preview);
  open.addEventListener('click', () => openSession(name));

  const trash = document.createElement('button');
  trash.className = 'trash';
  trash.innerHTML = TRASH_ICON;
  trash.setAttribute('aria-label', 'Move to Trash');
  trash.title = 'Move to Trash';

  const item = document.createElement('li');
  item.append(open, trash);
  trash.addEventListener('click', () => deleteSession(name, item));
  return item;
}

async function toggleSidebar() {
  if (!sidebar.hidden) {
    sidebar.hidden = true;
    focusEditor();
    return;
  }
  saveNow();
  const sessions = await api.listSessions();
  sessionList.replaceChildren(...sessions.map(sessionItem));
  sidebar.hidden = false;
}

async function openSession(name) {
  saveNow();
  const text = await api.openSession(name);
  sidebar.hidden = true;
  showInEditor(text);
}

async function deleteSession(name, item) {
  saveNow();
  const wasOpen = await api.deleteSession(name);
  item.remove();
  if (wasOpen) showInEditor('');
}

async function newSession() {
  saveNow();
  await api.newSession();
  sidebar.hidden = true;
  showInEditor('');
}

// --- Text size ----------------------------------------------------------------

let textSize = api.savedFontSize ?? TEXT_SIZE.initial;

function setTextSize(size, { save = true } = {}) {
  textSize = Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, size));
  document.documentElement.style.setProperty('--font-size', `${textSize}px`);
  if (save) api.saveFontSize(textSize);
}

const textBigger = () => setTextSize(textSize + TEXT_SIZE.step);
const textSmaller = () => setTextSize(textSize - TEXT_SIZE.step);
const textReset = () => setTextSize(TEXT_SIZE.initial);

// ponytail: fixed threshold; a mouse notch is 50–120px, trackpads send many small deltas. Tune if either feels off.
const WHEEL_PX_PER_STEP = 50;

/** Ctrl/Cmd+wheel: one text-size step per wheel notch, or per 50px of trackpad scrolling. */
function zoomWithModifierWheel() {
  let pending = 0;
  document.addEventListener('wheel', (event) => {
    if (!(isMac ? event.metaKey : event.ctrlKey)) return;
    event.preventDefault();
    pending += event.deltaY;
    if (Math.abs(pending) < WHEEL_PX_PER_STEP) return;
    setTextSize(textSize - Math.sign(pending) * TEXT_SIZE.step); // scrolling up (negative delta) enlarges
    pending = 0;
  }, { passive: false });
}

// --- Font ---------------------------------------------------------------------

// Bundled in fonts/ (see fonts.css); listed alphabetically, and the first is the default.
const FONTS = ['Atkinson Hyperlegible', 'EB Garamond', 'iA Writer Mono', 'Inter', 'Literata', 'Source Serif 4'];
const fontList = document.getElementById('font-list');
const fontButton = controls.querySelector('[data-action="toggleFontList"]');

function setFont(font, { save = true } = {}) {
  document.documentElement.style.setProperty('--prose-font', `"${font}"`);
  if (save) api.saveFont(font);
}

function showFontList(shown) {
  fontList.hidden = !shown;
  fontButton.setAttribute('aria-expanded', String(shown));
}

const closeFontList = () => showFontList(false);
const toggleFontList = () => showFontList(fontList.hidden);

function fontOption(font) {
  const option = Object.assign(document.createElement('li'), { textContent: font });
  option.setAttribute('role', 'option');
  option.style.fontFamily = `"${font}"`;
  option.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus in the editor
  option.addEventListener('click', () => {
    setFont(font);
    closeFontList();
  });
  return option;
}

function setUpFontList() {
  fontList.replaceChildren(...FONTS.map(fontOption));
  document.addEventListener('mousedown', (event) => {
    if (!fontList.hidden && !event.target.closest('#font-list, .font-button')) closeFontList();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !fontList.hidden) closeFontList();
  });
}

// --- Shortcuts and controls ---------------------------------------------------

const actions = { toggleSidebar, newSession, textBigger, textSmaller, textReset, toggleFontList, toggleFullscreen: api.toggleFullscreen };

const modifiedShortcuts = { o: 'toggleSidebar', n: 'newSession', '=': 'textBigger', '+': 'textBigger', '-': 'textSmaller', '0': 'textReset' };
const plainShortcuts = { F11: 'toggleFullscreen' };

function shortcutAction(event) {
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  if (event.altKey) return null;
  // macOS reserves F11, so fullscreen is Ctrl+Cmd+F there.
  if (isMac && event.ctrlKey && event.metaKey && event.key.toLowerCase() === 'f') return 'toggleFullscreen';
  return modifier ? modifiedShortcuts[event.key.toLowerCase()] : plainShortcuts[event.key];
}

function handleShortcuts() {
  document.addEventListener('keydown', (event) => {
    const action = shortcutAction(event);
    if (!action) return;
    event.preventDefault();
    actions[action]();
  });
}

function shortcutLabel(button) {
  const { shortcut, key, macKey } = button.dataset;
  if (key) return (isMac && macKey) || key;
  if (!shortcut) return null;
  return isMac ? `⌘${shortcut}` : `Ctrl+${shortcut}`;
}

function setUpControls() {
  for (const button of controls.querySelectorAll('button')) {
    const shortcut = shortcutLabel(button);
    button.title = button.getAttribute('aria-label') + (shortcut ? ` (${shortcut})` : '');
    button.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus in the editor
    button.addEventListener('click', () => actions[button.dataset.action]());
  }
}

// Chromium also fires mousemove when the window appears or scrolls under a still pointer; ignore those.
function onRealMouseMove(handler) {
  document.addEventListener('mousemove', (event) => {
    if (event.movementX || event.movementY) handler(event);
  });
}

function showControlsOnMouseMove() {
  let fadeTimer;
  const hide = () => {
    clearTimeout(fadeTimer);
    controls.classList.remove('shown');
    closeFontList();
  };
  // A pointer resting on the controls keeps them; moving off them fires mousemove and restarts the fade.
  const fadeUnlessHovered = () => { if (!controls.matches(':hover')) hide(); };
  onRealMouseMove(() => {
    controls.classList.add('shown');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(fadeUnlessHovered, CONTROLS_LINGER_MS);
  });
  editorElement.addEventListener('keydown', hide);
}

function hideCursorWhileTyping() {
  editorElement.addEventListener('keydown', () => document.body.classList.add('typing'));
  onRealMouseMove(() => document.body.classList.remove('typing'));
}

setTextSize(textSize, { save: false });
setFont(FONTS.includes(api.savedFont) ? api.savedFont : FONTS[0], { save: false });
setUpFontList();
handleShortcuts();
zoomWithModifierWheel();
setUpControls();
showControlsOnMouseMove();
hideCursorWhileTyping();
focusEditor();
