const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('freewriter', {
  platform: process.platform,
  textChanged: (text) => ipcRenderer.send('text-changed', text),
});
