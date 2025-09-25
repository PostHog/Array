const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  storeApiKey: (apiKey) => ipcRenderer.invoke('store-api-key', apiKey),
  retrieveApiKey: (encryptedKey) => ipcRenderer.invoke('retrieve-api-key', encryptedKey),
});