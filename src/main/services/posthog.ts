import { ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron';

export function registerPosthogIpc(): void {
  // IPC handlers for secure storage
  ipcMain.handle('store-api-key', async (_event: IpcMainInvokeEvent, apiKey: string): Promise<string> => {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(apiKey);
      return encrypted.toString('base64');
    }
    return apiKey;
  });

  ipcMain.handle('retrieve-api-key', async (_event: IpcMainInvokeEvent, encryptedKey: string): Promise<string | null> => {
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