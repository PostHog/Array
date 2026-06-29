// Helpers for capturing user-installed notification sounds (live recording or
// file import). Custom clips are stored inline as base64 data URLs in the
// settings store, so they're deliberately short: the duration cap keeps that
// persisted payload small and a notification ding should be brief anyway.

// Hard cap on clip length. Live recordings auto-stop here; imported files longer
// than this are rejected.
export const MAX_CUSTOM_SOUND_DURATION_MS = 5_000;

// Backstop on the stored payload regardless of reported duration (e.g. a
// high-bitrate import). ~1 MB of base64 sits comfortably within the settings
// store.
export const MAX_CUSTOM_SOUND_BYTES = 1_000_000;

// Preferred recorder containers, best first. Chromium (the Electron renderer)
// records Opus-in-WebM; the fallbacks cover other hosts.
const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export function pickRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return RECORDING_MIME_TYPES.find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}

export function isRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read audio data"));
    reader.readAsDataURL(blob);
  });
}

// Reads a clip's duration by loading just its metadata. Resolves null when the
// duration can't be determined — some streamed WebM blobs report Infinity, in
// which case callers fall back to the recorder's own elapsed timer.
export function getAudioDurationMs(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    const done = (value: number | null) => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      resolve(value);
    };
    audio.onloadedmetadata = () => {
      const seconds = audio.duration;
      done(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null);
    };
    audio.onerror = () => done(null);
    audio.src = src;
  });
}

// Approximate decoded byte length of a base64 data URL payload.
export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function formatDurationSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
