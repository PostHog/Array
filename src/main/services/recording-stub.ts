import { ipcMain } from "electron";

/**
 * Stub IPC handlers for recording functionality.
 * Actual implementation will be added in the next PR.
 */
export function registerRecordingIpc(): void {
  ipcMain.handle("recording:start", async () => {
    throw new Error("Recording service not yet implemented");
  });

  ipcMain.handle("recording:stop", async () => {
    throw new Error("Recording service not yet implemented");
  });

  ipcMain.handle("recording:list", async () => {
    return [];
  });

  ipcMain.handle("recording:delete", async () => {
    throw new Error("Recording service not yet implemented");
  });

  ipcMain.handle("recording:get-file", async () => {
    throw new Error("Recording service not yet implemented");
  });

  ipcMain.handle("recording:transcribe", async () => {
    throw new Error("Recording service not yet implemented");
  });
}
