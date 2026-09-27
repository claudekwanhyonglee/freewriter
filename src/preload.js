const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('freewriter', {
  platform: process.platform,
});
