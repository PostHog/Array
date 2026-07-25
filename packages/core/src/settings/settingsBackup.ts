import { unzipSync, zipSync } from "fflate";
import { z } from "zod";

const MAX_ARCHIVE_BYTES = 25_000_000;
const MAX_ENTRY_BYTES = 5_000_000;
const MANIFEST_PATH = "manifest.json";

export const settingsBackupCategorySchema = z.enum([
  "notifications",
  "agentDefaults",
  "composer",
  "terminal",
  "system",
  "appearance",
  "onboarding",
]);

export type SettingsBackupCategory = z.infer<
  typeof settingsBackupCategorySchema
>;

const soundSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(60),
  durationMs: z.number().nonnegative().max(5_300),
  file: z.string().regex(/^sounds\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/),
  mimeType: z.string().regex(/^audio\/[A-Za-z0-9.+-]+$/),
});

const categoriesSchema = z
  .object({
    notifications: z.object({
      desktopNotifications: z.boolean(),
      dockBadgeNotifications: z.boolean(),
      dockBounceNotifications: z.boolean(),
      toastNotifications: z.boolean(),
      completionSound: z.union([
        z.enum([
          "none",
          "guitar",
          "danilo",
          "revi",
          "meep",
          "meep-smol",
          "bubbles",
          "drop",
          "knock",
          "ring",
          "shoot",
          "slide",
          "switch",
          "wilhelm",
          "icq",
          "random-all",
          "random-custom",
        ]),
        z.string().regex(/^custom:[A-Za-z0-9_-]+$/),
      ]),
      completionVolume: z.number().min(0).max(100),
      scaleSoundWithTaskLength: z.boolean(),
    }),
    agentDefaults: z.object({
      defaultRunMode: z.enum(["local", "cloud", "last_used"]),
      defaultInitialTaskMode: z.enum(["plan", "last_used"]),
      defaultReasoningEffort: z.enum([
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "last_used",
      ]),
      defaultMessagingMode: z.enum(["queue", "steer"]),
    }),
    composer: z.object({
      autoConvertLongText: z.enum(["off", "1000", "2500", "5000", "10000"]),
      sendMessagesWith: z.enum(["enter", "cmd+enter"]),
      customInstructions: z.string(),
      diffOpenMode: z.enum(["auto", "split", "same-pane", "last-active-pane"]),
      conversationCollapseMode: z.string(),
    }),
    terminal: z.object({
      terminalFont: z.enum([
        "berkeley-mono",
        "jetbrains-mono",
        "system",
        "custom",
      ]),
      terminalCustomFontFamily: z.string(),
      terminalGpuRendering: z.boolean(),
    }),
    system: z.object({
      allowBypassPermissions: z.boolean(),
      preventSleepWhileRunning: z.boolean(),
      debugLogsCloudRuns: z.boolean(),
      autoPublishCloudRuns: z.boolean(),
      downloadUpdatesAutomatically: z.boolean(),
    }),
    appearance: z.object({
      hedgehogMode: z.boolean(),
      slotMachineMode: z.boolean(),
      brainrotMode: z.boolean(),
      mcpAppsDisabledServers: z.array(z.string()),
      dismissibleUpdateBanners: z.boolean(),
      useNewChatThread: z.boolean(),
      theme: z.enum(["light", "dark", "system"]),
    }),
    onboarding: z.object({
      lastSeenChangelogVersion: z.string().nullable(),
      hints: z.record(
        z.string(),
        z.object({
          count: z.number().int().nonnegative(),
          learned: z.boolean(),
        }),
      ),
    }),
  })
  .partial();

export const settingsBackupManifestSchema = z.object({
  format: z.literal("posthog-code-settings"),
  version: z.literal(1),
  exportedAt: z.string(),
  categories: categoriesSchema,
  sounds: z.array(soundSchema).max(100),
});

export type SettingsBackupManifest = z.infer<
  typeof settingsBackupManifestSchema
>;

export interface ExportSound {
  id: string;
  name: string;
  durationMs: number;
  dataUrl: string;
}

export interface ParsedSettingsBackup {
  manifest: SettingsBackupManifest;
  soundDataUrls: Record<string, string>;
}

function extensionForMimeType(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.split(";")[0] ?? "bin";
  return subtype === "mpeg"
    ? "mp3"
    : subtype.replace(/[^A-Za-z0-9]/g, "") || "bin";
}

function parseDataUrl(dataUrl: string): {
  mimeType: string;
  bytes: Uint8Array;
} {
  const match =
    /^data:(audio\/[A-Za-z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(
      dataUrl,
    );
  if (!match) throw new Error("A custom sound has invalid audio data");
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength > MAX_ENTRY_BYTES)
    throw new Error("A custom sound is too large");
  return { mimeType: match[1], bytes };
}

function toDataUrl(mimeType: string, bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function createSettingsBackup(
  categories: SettingsBackupManifest["categories"],
  sounds: ExportSound[],
  exportedAt = new Date().toISOString(),
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const soundEntries = sounds.map((sound) => {
    const { mimeType, bytes } = parseDataUrl(sound.dataUrl);
    const file = `sounds/${sound.id}.${extensionForMimeType(mimeType)}`;
    files[file] = bytes;
    return {
      id: sound.id,
      name: sound.name,
      durationMs: sound.durationMs,
      file,
      mimeType,
    };
  });
  const manifest = settingsBackupManifestSchema.parse({
    format: "posthog-code-settings",
    version: 1,
    exportedAt,
    categories,
    sounds: soundEntries,
  });
  files[MANIFEST_PATH] = Uint8Array.from(
    new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  );
  return zipSync(files, { level: 6 });
}

export function parseSettingsBackup(bytes: Uint8Array): ParsedSettingsBackup {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES)
    throw new Error("Settings archive is too large");
  const files = unzipSync(bytes);
  let expandedBytes = 0;
  for (const [name, contents] of Object.entries(files)) {
    if (name.includes("..") || name.startsWith("/") || name.includes("\\")) {
      throw new Error("Settings archive contains an unsafe path");
    }
    if (contents.byteLength > MAX_ENTRY_BYTES) {
      throw new Error("Settings archive contains an oversized file");
    }
    expandedBytes += contents.byteLength;
    if (expandedBytes > MAX_ARCHIVE_BYTES) {
      throw new Error("Expanded settings archive is too large");
    }
  }
  const rawManifest = files[MANIFEST_PATH];
  if (!rawManifest) throw new Error("Settings archive has no manifest");
  const manifest = settingsBackupManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(rawManifest)),
  );
  const soundDataUrls: Record<string, string> = {};
  for (const sound of manifest.sounds) {
    const soundBytes = files[sound.file];
    if (!soundBytes)
      throw new Error(`Settings archive is missing ${sound.file}`);
    soundDataUrls[sound.id] = toDataUrl(sound.mimeType, soundBytes);
  }
  return { manifest, soundDataUrls };
}
