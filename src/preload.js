const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('freewriter', {
  platform: process.platform,
  textChanged: (text) => ipcRenderer.send('text-changed', text),
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  openSession: (name) => ipcRenderer.invoke('open-session', name),
  newSession: () => ipcRenderer.invoke('new-session'),
});
