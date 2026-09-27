const api = window.freewriter;
const editor = document.getElementById('editor');
const sidebar = document.getElementById('sidebar');
const sessionList = document.getElementById('session-list');

function hideCursorWhileTyping() {
  editor.addEventListener('keydown', () => document.body.classList.add('typing'));
  document.addEventListener('mousemove', () => document.body.classList.remove('typing'));
}

function autosave() {
  editor.addEventListener('input', () => api.textChanged(editor.value));
}

function showInEditor(text) {
  editor.value = text;
  editor.setSelectionRange(text.length, text.length);
  editor.scrollTop = editor.scrollHeight;
  editor.focus();
}

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

const shortcuts = {
  o: toggleSidebar,
  n: newSession,
};

function handleShortcuts() {
  document.addEventListener('keydown', (event) => {
    const modifier = api.platform === 'darwin' ? event.metaKey : event.ctrlKey;
    const action = modifier && !event.altKey && shortcuts[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    action();
  });
}

hideCursorWhileTyping();
autosave();
handleShortcuts();
editor.focus();
