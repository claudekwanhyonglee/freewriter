const { app, BrowserWindow, Menu, nativeTheme } = require('electron');
const path = require('path');

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

app.whenReady().then(() => {
  setMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
