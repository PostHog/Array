const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  storeApiKey: (apiKey) => ipcRenderer.invoke('store-api-key', apiKey),
  retrieveApiKey: (encryptedKey) => ipcRenderer.invoke('retrieve-api-key', encryptedKey),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  validateRepo: (directoryPath) => ipcRenderer.invoke('validate-repo', directoryPath),
  checkWriteAccess: (directoryPath) => ipcRenderer.invoke('check-write-access', directoryPath),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  agentStart: async (params) => ipcRenderer.invoke('agent-start', params),
  agentCancel: async (taskId) => ipcRenderer.invoke('agent-cancel', taskId),
  onAgentEvent: (channel, listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});