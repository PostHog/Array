import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, experimental_transcribe as transcribe } from "ai";
import { app, desktopCapturer, ipcMain } from "electron";
import { z } from "zod";
import type { Recording } from "../../shared/types.js";

import {
  SUMMARY_PROMPT,
  TASK_EXTRACTION_PROMPT,
} from "./transcription-prompts.js";

async function ensureFileConstructor(): Promise<void> {
  if (globalThis.File) return;

  try {
    const { File: NodeFile } = await import("node:buffer");
    globalThis.File = NodeFile as typeof File;
  } catch {
    globalThis.File = class File extends Blob {
      name: string;
      lastModified: number;

      constructor(bits: BlobPart[], name: string, options?: FilePropertyBag) {
        super(bits, options);
        this.name = name;
        this.lastModified = options?.lastModified ?? Date.now();
      }
    } as typeof File;
  }
}

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

async function generateTranscriptSummary(
  transcriptText: string,
  openaiApiKey: string,
): Promise<string | null> {
  try {
    const openai = createOpenAI({ apiKey: openaiApiKey });

    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: z.object({
        title: z.string().describe("A brief 3-7 word summary title"),
      }),
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that creates concise titles for conversation transcripts. The title should be 3-7 words and capture the main topic.",
        },
        {
          role: "user",
          content: `${SUMMARY_PROMPT}\n${transcriptText}`,
        },
      ],
    });

    return object.title || null;
  } catch (error) {
    console.error("Failed to generate summary title:", error);
    return null;
  }
}

async function extractTasksFromTranscript(
  transcriptText: string,
  openaiApiKey: string,
): Promise<Array<{ title: string; description: string }>> {
  try {
    const openai = createOpenAI({ apiKey: openaiApiKey });

    const schema = z.object({
      tasks: z.array(
        z.object({
          title: z.string().describe("Brief task title"),
          description: z.string().describe("Detailed description with context"),
        }),
      ),
    });

    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that extracts actionable tasks from conversation transcripts. Be generous in identifying work items - include feature requests, requirements, and any work that needs to be done.",
        },
        {
          role: "user",
          content: `${TASK_EXTRACTION_PROMPT}\n${transcriptText}`,
        },
      ],
    });

    return object.tasks || [];
  } catch (error) {
    console.error("Failed to extract tasks from transcription:", error);
    return [];
  }
}

function safeLog(...args: unknown[]): void {
  try {
    console.log(...args);
  } catch {
    // Ignore logging errors
  }
}

export function registerRecordingIpc(): void {
  ensureFileConstructor();

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
    async (_event, recordingId: string, openaiApiKey: string) => {
      if (!validateRecordingId(recordingId)) {
        throw new Error("Invalid recording ID");
      }

      const filePath = path.join(recordingsDir, recordingId);
      const metadataPath = path.join(recordingsDir, `${recordingId}.json`);

      if (!fs.existsSync(filePath)) {
        throw new Error("Recording file not found");
      }

      const resolvedPath = fs.realpathSync.native(filePath);
      const recordingsDirResolved = fs.realpathSync.native(recordingsDir);
      if (!resolvedPath.startsWith(recordingsDirResolved)) {
        throw new Error("Invalid recording path");
      }

      let metadata: Record<string, unknown> = {};
      if (fs.existsSync(metadataPath)) {
        metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
      }

      metadata.transcription = {
        status: "processing",
        text: "",
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      try {
        const openai = createOpenAI({ apiKey: openaiApiKey });

        const audio = await readFile(filePath);
        const maxSize = 25 * 1024 * 1024;
        const fileSize = audio.length;

        safeLog(
          `[Transcription] Starting (${(fileSize / 1024 / 1024).toFixed(2)} MB)`,
        );

        if (fileSize > maxSize) {
          throw new Error(
            `Recording file is too large (${(fileSize / 1024 / 1024).toFixed(1)} MB). ` +
              `OpenAI Whisper API has a 25 MB limit. ` +
              `Please record shorter segments (under ~2 hours at standard quality).`,
          );
        }

        const result = await transcribe({
          model: openai.transcription("gpt-4o-mini-transcribe"),
          audio,
        });

        safeLog("[Transcription] Result:", result.text);

        const fullTranscriptText = result.text;

        const summaryTitle = await generateTranscriptSummary(
          fullTranscriptText,
          openaiApiKey,
        );

        const extractedTasks = await extractTasksFromTranscript(
          fullTranscriptText,
          openaiApiKey,
        );

        safeLog(
          `[Transcription] Complete - ${extractedTasks.length} tasks extracted`,
        );

        metadata.transcription = {
          status: "completed",
          text: fullTranscriptText,
          summary: summaryTitle,
          extracted_tasks: extractedTasks,
        };
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        return {
          status: "completed",
          text: fullTranscriptText,
          summary: summaryTitle,
          extracted_tasks: extractedTasks,
        };
      } catch (error) {
        console.error("[Transcription] Error:", error);

        metadata.transcription = {
          status: "error",
          text: "",
          error:
            error instanceof Error ? error.message : "Transcription failed",
        };
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        throw error;
      }
    },
  );
}
