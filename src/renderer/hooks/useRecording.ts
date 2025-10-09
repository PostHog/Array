import { useEffect } from "react";
import { useRecordingStore } from "@renderer/stores/recordingStore";

export function useRecording() {
  const {
    isRecording,
    recordingDuration,
    error,
    startRecording,
    stopRecording,
    incrementDuration,
  } = useRecordingStore();

  // Timer for recording duration - runs globally regardless of component lifecycle
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        incrementDuration();
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording, incrementDuration]);

  return {
    isRecording,
    recordingDuration,
    error,
    handleStartRecording: startRecording,
    handleStopRecording: stopRecording,
  };
}
