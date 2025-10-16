import type { Recording } from "@shared/types";
import { useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useRecordingStore } from "../stores/recordingStore";

/**
 * Hook that adds keyboard shortcuts and timer management to the recording store
 */
export function useAudioRecorder(
  saveRecording: (params: {
    recordingId: string;
    audioData: Uint8Array;
    duration: number;
  }) => Promise<Recording>,
) {
  const {
    isRecording,
    recordingDuration,
    recordingMode,
    selectedMicId,
    availableDevices,
    error,
    setRecordingMode,
    setSelectedMicId,
    setAvailableDevices,
    startRecording,
    stopRecording,
    incrementDuration,
  } = useRecordingStore();

  // Load available audio devices on mount
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      setAvailableDevices(audioInputs);
      if (audioInputs.length > 0 && !selectedMicId) {
        setSelectedMicId(audioInputs[0].deviceId);
      }
    });
  }, [selectedMicId, setAvailableDevices, setSelectedMicId]);

  // Timer for recording duration
  useEffect(() => {
    if (!isRecording) return;

    const timer = setInterval(() => {
      incrementDuration();
    }, 1000);

    return () => clearInterval(timer);
  }, [isRecording, incrementDuration]);

  // Keyboard shortcuts
  useHotkeys(
    "r",
    () => {
      if (!isRecording) {
        startRecording();
      }
    },
    { enableOnFormTags: false },
    [isRecording, startRecording],
  );

  useHotkeys(
    "s",
    () => {
      if (isRecording) {
        stopRecording(saveRecording);
      }
    },
    { enableOnFormTags: false },
    [isRecording, stopRecording, saveRecording],
  );

  // Check if system audio is supported
  const isSystemAudioSupported =
    "chrome" in window &&
    !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  return {
    isRecording,
    recordingDuration,
    recordingMode,
    availableDevices,
    selectedMicId,
    isSystemAudioSupported,
    error,
    setRecordingMode,
    setSelectedMicId,
    startRecording,
    stopRecording: () => stopRecording(saveRecording),
  };
}
