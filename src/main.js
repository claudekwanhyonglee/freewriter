const { app, BrowserWindow, Menu, nativeTheme, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Session, sessionsDir, listSessions, sessionPath } = require('./sessions');
const { settingsStore } = require('./settings');

let session;

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

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f7f3ea',
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
  session = new Session(session.dir, file);
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
  ipcMain.on('get-sessions-dir-url', (event) => { event.returnValue = `${pathToFileURL(session.dir).href}/`; });
}

function handleViewMessages(settings) {
  ipcMain.on('get-font-size', (event) => { event.returnValue = settings.get('fontSize') ?? null; });
  ipcMain.on('set-font-size', (_event, size) => {
    if (Number.isFinite(size)) settings.set('fontSize', size);
  });
  ipcMain.on('toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win.setFullScreen(!win.isFullScreen());
  });
  ipcMain.on('open-link', (_event, href) => openLink(href));
}

app.whenReady().then(() => {
  session = new Session(sessionsDir(app.getPath('documents')));
  handleSessionMessages();
  handleViewMessages(settingsStore(app.getPath('userData')));
  setMenu();
  createWindow();
});

// After the windows close, so it includes text the renderer sends while unloading.
app.on('will-quit', () => session?.flush());
app.on('window-all-closed', () => app.quit());
