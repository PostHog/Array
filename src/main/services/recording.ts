import fs from "node:fs";
import path from "node:path";
import { app, ipcMain } from "electron";
import OpenAI from "openai";
import type { Recording } from "../../shared/types.js";

// Polyfill File for OpenAI SDK
let FileConstructor: typeof File;
try {
  // Try importing from node:buffer (Node 20+)
  const { File: NodeFile } = await import("node:buffer");
  FileConstructor = NodeFile as typeof File;
} catch {
  // Fallback for Node < 20
  FileConstructor = class File extends Blob {
    name: string;
    lastModified: number;

    constructor(bits: BlobPart[], name: string, options?: FilePropertyBag) {
      super(bits, options);
      this.name = name;
      this.lastModified = options?.lastModified ?? Date.now();
    }
  } as typeof File;
}

if (!globalThis.File) {
  globalThis.File = FileConstructor;
}

interface RecordingSession {
  id: string;
  chunks: Buffer[];
  startTime: Date;
  stream: MediaStream | null;
}

const activeRecordings = new Map<string, RecordingSession>();
const recordingsDir = path.join(app.getPath("userData"), "recordings");

// Ensure recordings directory exists
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

/**
 * Generate a summary title for a transcript using GPT
 * @param transcriptText The transcript text to analyze
 * @param openaiApiKey The OpenAI API key
 * @returns A concise summary title, or null if generation fails
 */
async function generateTranscriptSummary(
  transcriptText: string,
  openaiApiKey: string,
): Promise<string | null> {
  try {
    const openai = new OpenAI({ apiKey: openaiApiKey });

    const summaryPrompt = `Create a very brief (3-7 words) title that summarizes what this conversation is about.

Return ONLY a JSON object with this exact structure:
{
  "title": "brief summary title"
}

Transcript:
${transcriptText}`;

    const summary = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that creates concise titles for conversation transcripts. The title should be 3-7 words and capture the main topic. Return only valid JSON with the exact structure requested.",
        },
        {
          role: "user",
          content: summaryPrompt,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = summary.choices[0].message.content || "{}";
    const result = JSON.parse(content);
    return result.title || null;
  } catch (error) {
    console.error("Failed to generate summary title:", error);
    return null;
  }
}

/**
 * Extract actionable tasks from a transcript using GPT
 * @param transcriptText The transcript text to analyze
 * @param openaiApiKey The OpenAI API key
 * @returns Array of extracted tasks, or empty array if extraction fails
 */
async function extractTasksFromTranscript(
  transcriptText: string,
  openaiApiKey: string,
): Promise<Array<{ title: string; description: string }>> {
  try {
    const openai = new OpenAI({ apiKey: openaiApiKey });

    const extractionPrompt = `Analyze the following conversation transcript and extract any actionable tasks, feature requests, bug fixes, or work items that were discussed or requested. This includes:
- Explicit action items ("we need to...", "let's build...")
- Feature requests ("I want...", "please build...")
- Bug reports ("this is broken...", "fix the...")
- Requirements ("it should have...", "make it...")

For each task, provide a clear title and a description with relevant context from the conversation.

Return ONLY a JSON object with this exact structure:
{
  "tasks": [
    { "title": "brief task title", "description": "detailed description with context" }
  ]
}

If there are no actionable tasks, return: { "tasks": [] }

Transcript:
${transcriptText}`;

    const extraction = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that extracts actionable tasks from conversation transcripts. Be generous in identifying work items - include feature requests, requirements, and any work that needs to be done. Return only valid JSON with the exact structure requested.",
        },
        {
          role: "user",
          content: extractionPrompt,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = extraction.choices[0].message.content || "{}";
    const result = JSON.parse(content);
    return result.tasks || [];
  } catch (error) {
    console.error("Failed to extract tasks from transcription:", error);
    return [];
  }
}

/**
 * Validates a recording ID to prevent path traversal attacks
 * @param recordingId The recording ID to validate
 * @returns True if the recording ID is safe, false otherwise
 */
function validateRecordingId(recordingId: string): boolean {
  // Only allow alphanumeric characters, dots, hyphens, and underscores
  const safePattern = /^[a-zA-Z0-9._-]+$/;
  if (!safePattern.test(recordingId)) {
    return false;
  }

  // Ensure the resolved path stays within the recordings directory
  const resolvedPath = path.resolve(path.join(recordingsDir, recordingId));
  const recordingsDirResolved = path.resolve(recordingsDir);
  return resolvedPath.startsWith(recordingsDirResolved + path.sep);
}

export function registerRecordingIpc(): void {
  ipcMain.handle("recording:start", async (_event) => {
    const recordingId = `recording-${Date.now()}`;
    const session: RecordingSession = {
      id: recordingId,
      chunks: [],
      startTime: new Date(),
      stream: null,
    };

    activeRecordings.set(recordingId, session);

    return { recordingId, startTime: session.startTime.toISOString() };
  });

  ipcMain.handle(
    "recording:stop",
    async (_event, recordingId: string, audioData: Uint8Array, duration: number) => {
      const session = activeRecordings.get(recordingId);
      if (!session) {
        throw new Error("Recording session not found");
      }

      // Save the recording
      const filename = `recording-${session.startTime.toISOString().replace(/[:.]/g, "-")}.webm`;
      const filePath = path.join(recordingsDir, filename);
      const metadataPath = path.join(recordingsDir, `${filename}.json`);

      // Save the audio data
      const buffer = Buffer.from(audioData);
      fs.writeFileSync(filePath, buffer);

      // Save metadata
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

      // Try to read metadata
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

      // Update metadata to show processing
      let metadata: any = {};
      if (fs.existsSync(metadataPath)) {
        metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
      }

      metadata.transcription = {
        status: "processing",
        text: "",
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      try {
        // Initialize OpenAI client
        const openai = new OpenAI({ apiKey: openaiApiKey });

        // Read the file
        const fileBuffer = fs.readFileSync(filePath);
        const maxSize = 25 * 1024 * 1024; // 25 MB limit
        const fileSize = fileBuffer.length;

        let fullTranscriptText = "";

        // If file is too large, we need to split it into chunks
        // For now, we'll just provide a clear error message
        // TODO: Implement audio chunking using ffmpeg or similar
        if (fileSize > maxSize) {
          throw new Error(
            `Recording file is too large (${(fileSize / 1024 / 1024).toFixed(1)} MB). ` +
            `OpenAI Whisper API has a 25 MB limit. ` +
            `Please record shorter segments (under ~2 hours at standard quality).`
          );
        }

        // Create a File object
        const file = new FileConstructor([fileBuffer], recordingId, { type: "audio/webm" });

        // Call Whisper API
        const transcription = await openai.audio.transcriptions.create({
          file: file,
          model: "whisper-1",
        });

        fullTranscriptText = transcription.text;

        // Generate summary title (don't fail transcription if this fails)
        const summaryTitle = await generateTranscriptSummary(fullTranscriptText, openaiApiKey);

        // Extract actionable tasks using GPT (don't fail transcription if this fails)
        const extractedTasks = await extractTasksFromTranscript(fullTranscriptText, openaiApiKey);

        // Update metadata with transcription, summary, and extracted tasks
        metadata.transcription = {
          status: "completed",
          text: transcription.text,
          summary: summaryTitle,
          extracted_tasks: extractedTasks,
        };
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        return {
          status: "completed",
          text: transcription.text,
          summary: summaryTitle,
          extracted_tasks: extractedTasks,
        };
      } catch (error) {
        // Update metadata with error
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
