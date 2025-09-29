const { ipcMain, safeStorage } = require('electron');

function registerPosthogIpc() {
  // IPC handlers for secure storage
  ipcMain.handle('store-api-key', async (_event, apiKey) => {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(apiKey);
      return encrypted.toString('base64');
    }
    return apiKey;
  });

  ipcMain.handle('retrieve-api-key', async (_event, encryptedKey) => {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const buffer = Buffer.from(encryptedKey, 'base64');
        return safeStorage.decryptString(buffer);
      } catch {
        return null;
      }
    }
    return encryptedKey;
  });
}

module.exports = { registerPosthogIpc };


