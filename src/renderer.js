const api = window.freewriter;
const isMac = api.platform === 'darwin';
const editor = document.getElementById('editor');
const sidebar = document.getElementById('sidebar');
const sessionList = document.getElementById('session-list');
const controls = document.getElementById('controls');

const TEXT_SIZE = { min: 14, max: 40, initial: 22, step: 2 };
const CONTROLS_LINGER_MS = 2000;

// --- Editor -----------------------------------------------------------------

function autosave() {
  editor.addEventListener('input', () => api.textChanged(editor.value));
}

function showInEditor(text) {
  editor.value = text;
  editor.setSelectionRange(text.length, text.length);
  editor.scrollTop = editor.scrollHeight;
  editor.focus();
}

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
    editor.focus();
    return;
  }
  const sessions = await api.listSessions();
  sessionList.replaceChildren(...sessions.map(sessionItem));
  sidebar.hidden = false;
}

async function openSession(name) {
  const text = await api.openSession(name);
  sidebar.hidden = true;
  showInEditor(text);
}

async function newSession() {
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

// --- Shortcuts and controls ---------------------------------------------------

const actions = { toggleSidebar, newSession, textBigger, textSmaller, textReset, toggleFullscreen: api.toggleFullscreen };

const modifiedShortcuts = { o: 'toggleSidebar', n: 'newSession', '=': 'textBigger', '+': 'textBigger', '-': 'textSmaller', '0': 'textReset' };
const plainShortcuts = { F11: 'toggleFullscreen' };

function shortcutAction(event) {
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  if (event.altKey) return null;
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
  const { shortcut, key } = button.dataset;
  if (key) return key;
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
  onRealMouseMove(() => {
    controls.classList.add('shown');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(hide, CONTROLS_LINGER_MS);
  });
  editor.addEventListener('keydown', hide);
}

function hideCursorWhileTyping() {
  editor.addEventListener('keydown', () => document.body.classList.add('typing'));
  onRealMouseMove(() => document.body.classList.remove('typing'));
}

setTextSize(textSize, { save: false });
autosave();
handleShortcuts();
setUpControls();
showControlsOnMouseMove();
hideCursorWhileTyping();
editor.focus();
