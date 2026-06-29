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
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_SECONDS = MAX_CUSTOM_SOUND_DURATION_MS / 1000;
// Real durations can read a touch over the cap (encoder rounding); allow a small
// slack before rejecting an otherwise-fine clip.
const DURATION_TOLERANCE_MS = 300;

interface CapturedClip {
  dataUrl: string;
  durationMs: number;
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

  const [name, setName] = useState("");
  const [clip, setClip] = useState<CapturedClip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

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

  const stopRecording = useCallback(() => {
    stopTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setIsRecording(false);
  }, [stopTimer]);

  // Validate a captured/imported blob, then stash it as the pending clip.
  // `fallbackDurationMs` is used when the container doesn't expose a duration
  // (common for freshly-recorded WebM), where the recorder's elapsed time wins.
  const acceptBlob = useCallback(
    async (blob: Blob, fallbackDurationMs: number | null) => {
      const dataUrl = await blobToDataUrl(blob);
      if (dataUrlByteLength(dataUrl) > MAX_CUSTOM_SOUND_BYTES) {
        setError("That clip is too large. Keep it short (max ~1 MB).");
        return;
      }
      const decoded = await getAudioDurationMs(dataUrl);
      const durationMs = decoded ?? fallbackDurationMs ?? 0;
      if (durationMs > MAX_CUSTOM_SOUND_DURATION_MS + DURATION_TOLERANCE_MS) {
        setError(`Clips must be ${MAX_SECONDS}s or shorter.`);
        return;
      }
      setError(null);
      setClip({ dataUrl, durationMs });
    },
    [],
  );

  const startRecording = useCallback(async () => {
    setError(null);
    setClip(null);
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
      setIsRecording(true);
      setElapsedMs(0);
      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_CUSTOM_SOUND_DURATION_MS) stopRecording();
      }, 100);
    } catch {
      stopStream();
      setError(
        "Microphone access was blocked. Allow it in your system settings.",
      );
    }
  }, [acceptBlob, stopRecording, stopStream]);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("audio/")) {
        setError("Choose an audio file.");
        return;
      }
      if (file.size > MAX_CUSTOM_SOUND_BYTES) {
        setError("That file is too large. Keep it short (max ~1 MB).");
        return;
      }
      if (!name.trim()) {
        // Seed the name from the filename so the user has a sensible default.
        setName(file.name.replace(/\.[^.]+$/, ""));
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

  const reset = useCallback(() => {
    stopRecording();
    stopStream();
    stopTimer();
    previewRef.current?.pause();
    previewRef.current = null;
    setName("");
    setClip(null);
    setError(null);
    setElapsedMs(0);
  }, [stopRecording, stopStream, stopTimer]);

  // Tidy up any in-flight recording when the dialog closes or unmounts.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);
  useEffect(() => reset, [reset]);

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
    onOpenChange(false);
  }, [addCustomSound, clip, name, onOpenChange, setCompletionSound]);

  const canSave = name.trim().length > 0 && clip !== null && !isRecording;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
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
              onChange={(event) => setName(event.target.value)}
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
                  onClick={() => setClip(null)}
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
