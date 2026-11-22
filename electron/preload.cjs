const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  agent: (spec, center) => ipcRenderer.invoke('agent', spec, center),
});
