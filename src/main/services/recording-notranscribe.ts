import fs from "node:fs";
import path from "node:path";
import { app, desktopCapturer, ipcMain } from "electron";
import type { Recording } from "../../shared/types.js";

interface RecordingSession {
  id: string;
  startTime: Date;
}

const activeRecordings = new Map<string, RecordingSession>();
const recordingsDir = path.join(app.getPath("userData"), "recordings");

if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

/**
 * Validates a recording ID to prevent path traversal attacks
 */
function validateRecordingId(recordingId: string): boolean {
  const safePattern = /^[a-zA-Z0-9._-]+$/;
  if (!safePattern.test(recordingId)) {
    return false;
  }

  const resolvedPath = path.resolve(path.join(recordingsDir, recordingId));
  const recordingsDirResolved = path.resolve(recordingsDir);
  return resolvedPath.startsWith(recordingsDirResolved + path.sep);
}

function safeLog(...args: unknown[]): void {
  try {
    console.log(...args);
  } catch {
    // Ignore logging errors
  }
}

export function registerRecordingIpc(): void {
  ipcMain.handle(
    "desktop-capturer:get-sources",
    async (_event, options: { types: ("screen" | "window")[] }) => {
      const sources = await desktopCapturer.getSources(options);

      const plainSources = sources.map((source) => {
        return {
          id: String(source.id),
          name: String(source.name),
        };
      });

      safeLog(`[Desktop Capturer] Found ${plainSources.length} sources`);
      return plainSources;
    },
  );

  ipcMain.handle("recording:start", async (_event) => {
    const recordingId = `recording-${Date.now()}`;
    const session: RecordingSession = {
      id: recordingId,
      startTime: new Date(),
    };

    activeRecordings.set(recordingId, session);

    return { recordingId, startTime: session.startTime.toISOString() };
  });

  ipcMain.handle(
    "recording:stop",
    async (
      _event,
      recordingId: string,
      audioData: Uint8Array,
      duration: number,
    ) => {
      const session = activeRecordings.get(recordingId);
      if (!session) {
        throw new Error("Recording session not found");
      }

      const filename = `recording-${session.startTime.toISOString().replace(/[:.]/g, "-")}.webm`;
      const filePath = path.join(recordingsDir, filename);
      const metadataPath = path.join(recordingsDir, `${filename}.json`);

      const buffer = Buffer.from(audioData);
      fs.writeFileSync(filePath, buffer);

      const metadata = {
        duration,
        created_at: session.startTime.toISOString(),
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      const recording: Recording = {
        id: filename,
        filename,
        duration,
        created_at: session.startTime.toISOString(),
        file_path: filePath,
      };

      activeRecordings.delete(recordingId);

      return recording;
    },
  );

  ipcMain.handle("recording:list", async (_event) => {
    const recordings: Recording[] = [];

    if (!fs.existsSync(recordingsDir)) {
      return recordings;
    }

    const files = fs.readdirSync(recordingsDir);

    for (const file of files) {
      if (!file.endsWith(".webm")) continue;

      const filePath = path.join(recordingsDir, file);
      const metadataPath = path.join(recordingsDir, `${file}.json`);

      let duration = 0;
      let createdAt = new Date().toISOString();
      let transcription: Recording["transcription"];

      if (fs.existsSync(metadataPath)) {
        try {
          const metadataContent = fs.readFileSync(metadataPath, "utf-8");
          const metadata = JSON.parse(metadataContent);
          duration = metadata.duration || 0;
          createdAt = metadata.created_at || createdAt;
          transcription = metadata.transcription;
        } catch (err) {
          console.error("Failed to read metadata:", err);
        }
      }

      recordings.push({
        id: file,
        filename: file,
        duration,
        created_at: createdAt,
        file_path: filePath,
        transcription,
      });
    }

    return recordings.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  });

  ipcMain.handle("recording:delete", async (_event, recordingId: string) => {
    if (!validateRecordingId(recordingId)) {
      throw new Error("Invalid recording ID");
    }

    const filePath = path.join(recordingsDir, recordingId);

    const resolvedPath = fs.realpathSync.native(filePath);
    const recordingsDirResolved = fs.realpathSync.native(recordingsDir);
    if (!resolvedPath.startsWith(recordingsDirResolved)) {
      throw new Error("Invalid recording path");
    }

    const metadataPath = path.join(recordingsDir, `${recordingId}.json`);

    let deleted = false;

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      deleted = true;
    }

    if (fs.existsSync(metadataPath)) {
      fs.unlinkSync(metadataPath);
    }

    return deleted;
  });

  ipcMain.handle("recording:get-file", async (_event, recordingId: string) => {
    if (!validateRecordingId(recordingId)) {
      throw new Error("Invalid recording ID");
    }

    const filePath = path.join(recordingsDir, recordingId);

    if (!fs.existsSync(filePath)) {
      throw new Error("Recording file not found");
    }

    const resolvedPath = fs.realpathSync.native(filePath);
    const recordingsDirResolved = fs.realpathSync.native(recordingsDir);
    if (!resolvedPath.startsWith(recordingsDirResolved)) {
      throw new Error("Invalid recording path");
    }

    const buffer = fs.readFileSync(filePath);
    return buffer;
  });

  ipcMain.handle(
    "recording:transcribe",
    async (_event, _recordingId: string, _openaiApiKey: string) => {
      throw new Error("Transcription not yet implemented");
    },
  );
}
