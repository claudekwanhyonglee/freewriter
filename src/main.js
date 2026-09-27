const { app, BrowserWindow, Menu, nativeTheme, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Session, sessionsDir, listSessions, sessionPath } = require('./sessions');
const { settingsStore } = require('./settings');
const { sessionSearch } = require('./search');

let session;
let search;

/** A session whose saves keep the search index current. */
const startSession = (dir, file = null) => new Session(dir, file, (saved, text) => search.update(path.basename(saved), text));

function setMenu() {
  // macOS needs an app/edit menu for Cmd+C/V/Z/Q; it lives in the global menu bar, not the window.
  const menu = process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }])
    : null;
  Menu.setApplicationMenu(menu);
}

/** Links never replace the editor or open app windows; the OS browser gets them instead. */
function keepOnEditor(win) {
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

const EXTERNAL_PROTOCOLS = ['http:', 'https:', 'mailto:'];

function openLink(href) {
  const url = URL.parse(href);
  if (url && EXTERNAL_PROTOCOLS.includes(url.protocol)) shell.openExternal(url.href);
}

const BACKGROUNDS = { light: '#f7f3ea', dark: '#1e1e1e' };

/** A saved theme also sets the native one, so the title bar and first paint agree with the page. */
function applyTheme(theme) {
  if (theme) nativeTheme.themeSource = theme;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 750,
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: BACKGROUNDS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setMenuBarVisibility(false);
  keepOnEditor(win);
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'index.html'));
  return win;
}

function switchSession(file = null) {
  session.flush();
  session = startSession(session.dir, file);
}

/**
 * Moves a session file to the OS trash, where it can be recovered, so there's no confirmation.
 * Deleting the open session starts a new one; resolves to whether that happened.
 */
async function deleteSession(file) {
  session.flush(); // the trashed copy holds everything written
  const wasOpen = file === session.file;
  if (wasOpen) session = startSession(session.dir); // not switchSession: its flush would recreate the file
  await shell.trashItem(file);
  search.remove(path.basename(file));
  return wasOpen;
}

function handleSessionMessages() {
  ipcMain.on('text-changed', (event, text) => {
    session.update(text);
    event.returnValue = null;
  });
  ipcMain.handle('list-sessions', () => {
    session.flush();
    return listSessions(session.dir);
  });
  ipcMain.handle('open-session', (_event, name) => {
    const file = sessionPath(session.dir, name);
    switchSession(file);
    return fs.readFileSync(file, 'utf8');
  });
  ipcMain.handle('new-session', () => switchSession());
  ipcMain.handle('delete-session', (_event, name) => deleteSession(sessionPath(session.dir, name)));
  ipcMain.handle('search-sessions', (_event, query) => search.search(String(query)));
  ipcMain.on('get-sessions-dir-url', (event) => { event.returnValue = `${pathToFileURL(session.dir).href}/`; });
}

/** The settings the renderer may save, and what a valid value looks like. */
const SETTINGS = {
  fontSize: Number.isFinite,
  font: (value) => typeof value === 'string' && value.length < 100,
  theme: (value) => Object.hasOwn(BACKGROUNDS, value),
};

function handleViewMessages(settings) {
  ipcMain.on('get-setting', (event, key) => { event.returnValue = settings.get(key) ?? null; });
  ipcMain.on('set-setting', (_event, key, value) => {
    if (!SETTINGS[key]?.(value)) return;
    settings.set(key, value);
    if (key === 'theme') applyTheme(value);
  });
  ipcMain.on('toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win.setFullScreen(!win.isFullScreen());
  });
  ipcMain.on('exit-fullscreen', (event) => BrowserWindow.fromWebContents(event.sender).setFullScreen(false));
  ipcMain.on('open-link', (_event, href) => openLink(href));
}

app.whenReady().then(() => {
  const dir = sessionsDir(app.getPath('documents'));
  search = sessionSearch(dir); // indexes in the background
  session = startSession(dir);
  handleSessionMessages();
  const settings = settingsStore(app.getPath('userData'));
  handleViewMessages(settings);
  applyTheme(settings.get('theme'));
  setMenu();
  createWindow();
});

// After the windows close, so it includes text the renderer sends while unloading.
app.on('will-quit', () => session?.flush());
app.on('window-all-closed', () => app.quit());
