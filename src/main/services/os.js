const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

function registerOsIpc(getMainWindow) {
  ipcMain.handle('select-directory', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Select a repository folder',
      properties: ['openDirectory', 'createDirectory', 'treatPackageAsDirectory'],
    });
    if (result.canceled || !result.filePaths?.length) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('validate-repo', async (_event, directoryPath) => {
    if (!directoryPath) return false;
    try {
      await execAsync('git rev-parse --is-inside-work-tree', { cwd: directoryPath });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('check-write-access', async (_event, directoryPath) => {
    if (!directoryPath) return false;
    try {
      await fsPromises.access(directoryPath, fs.constants.W_OK);
      const testFile = path.join(directoryPath, `.agent-write-test-${Date.now()}`);
      await fsPromises.writeFile(testFile, 'ok');
      await fsPromises.unlink(testFile).catch(() => {});
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('show-message-box', async (_event, options) => {
    const win = getMainWindow();
    const result = await dialog.showMessageBox(win, {
      type: options?.type || 'info',
      title: options?.title || 'Mission Control',
      message: options?.message || '',
      detail: options?.detail,
      buttons: Array.isArray(options?.buttons) && options.buttons.length > 0 ? options.buttons : ['OK'],
      defaultId: options?.defaultId ?? 0,
      cancelId: options?.cancelId ?? 1,
    });
    return { response: result.response };
  });
}

module.exports = { registerOsIpc };


