const { app, BrowserWindow, Menu, nativeTheme, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { Session, sessionsDir, listSessions, sessionPath } = require('./sessions');

let session;

function setMenu() {
  // macOS needs an app/edit menu for Cmd+C/V/Z/Q; it lives in the global menu bar, not the window.
  const menu = process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }])
    : null;
  Menu.setApplicationMenu(menu);
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
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'index.html'));
  return win;
}

function switchSession(file = null) {
  session.flush();
  session = new Session(session.dir, file);
}

function handleSessionMessages() {
  ipcMain.on('text-changed', (_event, text) => session.update(text));
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
}

app.whenReady().then(() => {
  session = new Session(sessionsDir(app.getPath('documents')));
  handleSessionMessages();
  setMenu();
  createWindow();
});

app.on('before-quit', () => session?.flush());
app.on('window-all-closed', () => app.quit());
