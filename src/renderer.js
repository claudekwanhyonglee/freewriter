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

function sessionItem({ name, label, firstLine }) {
  const button = document.createElement('button');
  const date = document.createElement('span');
  const preview = document.createElement('span');
  date.className = 'date';
  date.textContent = label;
  preview.className = 'preview';
  preview.textContent = firstLine;
  button.append(date, preview);
  button.addEventListener('click', () => openSession(name));

  const item = document.createElement('li');
  item.append(button);
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

// --- Shortcuts and controls ---------------------------------------------------

const actions = { toggleSidebar, newSession, textBigger, textSmaller, textReset, toggleFullscreen: api.toggleFullscreen };

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
  return isMac ? `⌘${shortcut}` : `Ctrl+${shortcut}`;
}

function setUpControls() {
  for (const button of controls.querySelectorAll('button')) {
    button.title = `${button.getAttribute('aria-label')} (${shortcutLabel(button)})`;
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
handleShortcuts();
zoomWithModifierWheel();
setUpControls();
showControlsOnMouseMove();
hideCursorWhileTyping();
focusEditor();
