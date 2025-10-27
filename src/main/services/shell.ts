import * as os from "node:os";
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import * as pty from "node-pty";

interface ShellSession {
  pty: pty.IPty;
  webContents: WebContents;
}

const sessions = new Map<string, ShellSession>();

function getDefaultShell(): string {
  const platform = os.platform();

  if (platform === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }

  return process.env.SHELL || "/bin/bash";
}

export function registerShellIpc(): void {
  // Create new shell session
  ipcMain.handle(
    "shell:create",
    async (
      event: IpcMainInvokeEvent,
      sessionId: string,
      cwd?: string,
    ): Promise<void> => {
      try {
        // Clean up existing session if any
        const existing = sessions.get(sessionId);
        if (existing) {
          existing.pty.kill();
          sessions.delete(sessionId);
        }

        const shell = getDefaultShell();
        const homeDir = os.homedir();

        const ptyProcess = pty.spawn(shell, [], {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd: cwd || homeDir,
          env: process.env as Record<string, string>,
        });

        // Send data to renderer
        ptyProcess.onData((data: string) => {
          event.sender.send(`shell:data:${sessionId}`, data);
        });

        // Handle exit
        ptyProcess.onExit(() => {
          event.sender.send(`shell:exit:${sessionId}`);
          sessions.delete(sessionId);
        });

        sessions.set(sessionId, {
          pty: ptyProcess,
          webContents: event.sender,
        });
      } catch (error) {
        console.error(`Failed to create shell session ${sessionId}:`, error);
        throw error;
      }
    },
  );

  // Write data to shell
  ipcMain.handle(
    "shell:write",
    async (
      _event: IpcMainInvokeEvent,
      sessionId: string,
      data: string,
    ): Promise<void> => {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Shell session ${sessionId} not found`);
      }

      session.pty.write(data);
    },
  );

  // Resize shell
  ipcMain.handle(
    "shell:resize",
    async (
      _event: IpcMainInvokeEvent,
      sessionId: string,
      cols: number,
      rows: number,
    ): Promise<void> => {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Shell session ${sessionId} not found`);
      }

      session.pty.resize(cols, rows);
    },
  );

  // Destroy shell session
  ipcMain.handle(
    "shell:destroy",
    async (_event: IpcMainInvokeEvent, sessionId: string): Promise<void> => {
      const session = sessions.get(sessionId);
      if (!session) {
        return; // Already destroyed
      }

      session.pty.kill();
      sessions.delete(sessionId);
    },
  );
}
