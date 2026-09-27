const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('freewriter', {
  platform: process.platform,
  // Synchronous, so text sent while the window closes arrives before the app quits.
  textChanged: (text) => ipcRenderer.sendSync('text-changed', text),
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  openSession: (name) => ipcRenderer.invoke('open-session', name),
  newSession: () => ipcRenderer.invoke('new-session'),
  deleteSession: (name) => ipcRenderer.invoke('delete-session', name),
  // Read synchronously so the first paint already uses the saved size and font.
  savedFontSize: ipcRenderer.sendSync('get-setting', 'fontSize'),
  saveFontSize: (size) => ipcRenderer.send('set-setting', 'fontSize', size),
  savedFont: ipcRenderer.sendSync('get-setting', 'font'),
  saveFont: (font) => ipcRenderer.send('set-setting', 'font', font),
  savedTheme: ipcRenderer.sendSync('get-setting', 'theme'),
  saveTheme: (theme) => ipcRenderer.send('set-setting', 'theme', theme),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  exitFullscreen: () => ipcRenderer.send('exit-fullscreen'),
  openLink: (url) => ipcRenderer.send('open-link', url),
  sessionsDirUrl: ipcRenderer.sendSync('get-sessions-dir-url'),
});
