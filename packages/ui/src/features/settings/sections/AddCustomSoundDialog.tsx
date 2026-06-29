import {
  Microphone,
  Play,
  Stop,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { toast } from "@posthog/ui/primitives/toast";
import {
  blobToDataUrl,
  dataUrlByteLength,
  formatDurationSeconds,
  getAudioDurationMs,
  isRecordingSupported,
  MAX_CUSTOM_SOUND_BYTES,
  MAX_CUSTOM_SOUND_DURATION_MS,
  pickRecordingMimeType,
} from "@posthog/ui/utils/customSound";
import {
  Button,
  Dialog,
  Flex,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useCallback, useEffect, useReducer, useRef } from "react";

const MAX_SECONDS = MAX_CUSTOM_SOUND_DURATION_MS / 1000;
// Real durations can read a touch over the cap (encoder rounding); allow a small
// slack before rejecting an otherwise-fine clip.
const DURATION_TOLERANCE_MS = 300;

interface CapturedClip {
  dataUrl: string;
  durationMs: number;
}

// All the dialog's transient state lives in one reducer so a single logical
// step (e.g. "recording started") is one update rather than a fan-out of
// separate useState setters.
interface DialogState {
  name: string;
  clip: CapturedClip | null;
  error: string | null;
  isRecording: boolean;
  elapsedMs: number;
}

type DialogAction =
  | { type: "setName"; name: string }
  | { type: "error"; message: string }
  | { type: "recordingStarted" }
  | { type: "recordingStopped" }
  | { type: "tick"; elapsedMs: number }
  | { type: "clipReady"; clip: CapturedClip }
  | { type: "clearClip" }
  | { type: "reset" };

const INITIAL_STATE: DialogState = {
  name: "",
  clip: null,
  error: null,
  isRecording: false,
  elapsedMs: 0,
};

function reducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case "setName":
      return { ...state, name: action.name };
    case "error":
      return { ...state, error: action.message, isRecording: false };
    case "recordingStarted":
      return {
        ...state,
        error: null,
        clip: null,
        isRecording: true,
        elapsedMs: 0,
      };
    case "recordingStopped":
      return { ...state, isRecording: false };
    case "tick":
      return { ...state, elapsedMs: action.elapsedMs };
    case "clipReady":
      return { ...state, clip: action.clip, error: null };
    case "clearClip":
      return { ...state, clip: null };
    case "reset":
      return INITIAL_STATE;
    default:
      return state;
  }
}

export function AddCustomSoundDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addCustomSound = useSettingsStore((s) => s.addCustomSound);
  const setCompletionSound = useSettingsStore((s) => s.setCompletionSound);

  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const { name, clip, error, isRecording, elapsedMs } = state;

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const recordingSupported = isRecordingSupported();

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Tear down any in-flight recorder/stream/timer/preview. Detaches the
  // recorder's handlers first so a late onstop can't dispatch into a dialog
  // that's already closing.
  const releaseResources = useCallback(() => {
    stopTimer();
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== "inactive") recorder.stop();
      recorderRef.current = null;
    }
    stopStream();
    previewRef.current?.pause();
    previewRef.current = null;
  }, [stopStream, stopTimer]);

  const stopRecording = useCallback(() => {
    stopTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    dispatch({ type: "recordingStopped" });
  }, [stopTimer]);

  // Validate a captured/imported blob, then stash it as the pending clip.
  // `fallbackDurationMs` is used when the container doesn't expose a duration
  // (common for freshly-recorded WebM), where the recorder's elapsed time wins.
  const acceptBlob = useCallback(
    async (blob: Blob, fallbackDurationMs: number | null) => {
      const dataUrl = await blobToDataUrl(blob);
      if (dataUrlByteLength(dataUrl) > MAX_CUSTOM_SOUND_BYTES) {
        dispatch({
          type: "error",
          message: "That clip is too large. Keep it short (max ~1 MB).",
        });
        return;
      }
      const decoded = await getAudioDurationMs(dataUrl);
      const durationMs = decoded ?? fallbackDurationMs ?? 0;
      if (durationMs > MAX_CUSTOM_SOUND_DURATION_MS + DURATION_TOLERANCE_MS) {
        dispatch({
          type: "error",
          message: `Clips must be ${MAX_SECONDS}s or shorter.`,
        });
        return;
      }
      dispatch({ type: "clipReady", clip: { dataUrl, durationMs } });
    },
    [],
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickRecordingMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      const startedAt = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const elapsed = Math.min(
          Date.now() - startedAt,
          MAX_CUSTOM_SOUND_DURATION_MS,
        );
        stopStream();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        void acceptBlob(blob, elapsed);
      };
      recorder.start();
      recorderRef.current = recorder;
      dispatch({ type: "recordingStarted" });
      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        dispatch({ type: "tick", elapsedMs: elapsed });
        if (elapsed >= MAX_CUSTOM_SOUND_DURATION_MS) stopRecording();
      }, 100);
    } catch {
      stopStream();
      dispatch({
        type: "error",
        message:
          "Microphone access was blocked. Allow it in your system settings.",
      });
    }
  }, [acceptBlob, stopRecording, stopStream]);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("audio/")) {
        dispatch({ type: "error", message: "Choose an audio file." });
        return;
      }
      if (file.size > MAX_CUSTOM_SOUND_BYTES) {
        dispatch({
          type: "error",
          message: "That file is too large. Keep it short (max ~1 MB).",
        });
        return;
      }
      if (!name.trim()) {
        // Seed the name from the filename so the user has a sensible default.
        dispatch({ type: "setName", name: file.name.replace(/\.[^.]+$/, "") });
      }
      await acceptBlob(file, null);
    },
    [acceptBlob, name],
  );

  const playPreview = useCallback(() => {
    if (!clip) return;
    previewRef.current?.pause();
    const audio = new Audio(clip.dataUrl);
    previewRef.current = audio;
    audio.play().catch(() => {
      // Ignore — preview is best-effort.
    });
  }, [clip]);

  // Reset on close in the close handler itself (not a useEffect watching
  // `open`) so there's no extra render showing stale state between commits.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        releaseResources();
        dispatch({ type: "reset" });
      }
      onOpenChange(next);
    },
    [onOpenChange, releaseResources],
  );

  // Release media resources if the dialog unmounts mid-recording.
  useEffect(() => releaseResources, [releaseResources]);

  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed || !clip) return;
    const id = crypto.randomUUID();
    addCustomSound({
      id,
      name: trimmed,
      dataUrl: clip.dataUrl,
      durationMs: clip.durationMs,
    });
    setCompletionSound(`custom:${id}`);
    toast.success(`Added "${trimmed}"`);
    handleOpenChange(false);
  }, [addCustomSound, clip, handleOpenChange, name, setCompletionSound]);

  const canSave = name.trim().length > 0 && clip !== null && !isRecording;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content maxWidth="420px">
        <Dialog.Title>Add custom sound</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Record a clip or import an audio file, then give it a name. Clips must
          be {MAX_SECONDS}s or shorter.
        </Dialog.Description>

        <Flex direction="column" gap="3">
          <Flex direction="column" gap="1">
            <Text
              as="label"
              htmlFor="custom-sound-name"
              size="2"
              weight="medium"
            >
              Name
            </Text>
            <TextField.Root
              id="custom-sound-name"
              value={name}
              onChange={(event) =>
                dispatch({ type: "setName", name: event.target.value })
              }
              placeholder="e.g. My ding"
              maxLength={60}
            />
          </Flex>

          <Flex direction="column" gap="2">
            <Text as="div" size="2" weight="medium">
              Sound
            </Text>
            <Flex gap="2" align="center" wrap="wrap">
              {isRecording ? (
                <Button color="red" onClick={stopRecording}>
                  <Stop weight="fill" /> Stop (
                  {formatDurationSeconds(elapsedMs)})
                </Button>
              ) : (
                <Button
                  variant="soft"
                  onClick={startRecording}
                  disabled={!recordingSupported}
                  title={
                    recordingSupported
                      ? undefined
                      : "Recording isn't available on this device"
                  }
                >
                  <Microphone /> Record
                </Button>
              )}
              <Button
                variant="soft"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRecording}
              >
                <UploadSimple /> Import file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                hidden
                aria-label="Import audio file"
                onChange={(event) => {
                  void handleFile(event.target.files?.[0]);
                  // Allow re-selecting the same file after a rejection.
                  event.target.value = "";
                }}
              />
            </Flex>

            {clip && !isRecording && (
              <Flex align="center" gap="2">
                <IconButton variant="soft" size="1" onClick={playPreview}>
                  <Play weight="fill" />
                </IconButton>
                <Text size="2" color="gray">
                  Clip ready · {formatDurationSeconds(clip.durationMs)}
                </Text>
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="1"
                  onClick={() => dispatch({ type: "clearClip" })}
                  aria-label="Discard clip"
                >
                  <Trash />
                </IconButton>
              </Flex>
            )}

            {error && (
              <Text size="2" color="red">
                {error}
              </Text>
            )}
          </Flex>
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </Dialog.Close>
          <Button onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
