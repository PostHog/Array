import { useEffect, useRef } from "react";

export function useMeetingDetection(
  startRecordingTrigger: number | undefined,
  isRecording: boolean,
  onStartRecording: () => void,
) {
  const prevTriggerRef = useRef(0);
  const onStartRecordingRef = useRef(onStartRecording);

  // Keep ref up to date
  useEffect(() => {
    onStartRecordingRef.current = onStartRecording;
  }, [onStartRecording]);

  // Watch for meeting detection trigger
  useEffect(() => {
    if (
      startRecordingTrigger &&
      startRecordingTrigger > prevTriggerRef.current &&
      !isRecording
    ) {
      console.log(
        "[RecordingsView] Start recording trigger fired, starting recording",
      );
      prevTriggerRef.current = startRecordingTrigger;
      onStartRecordingRef.current();
    }
  }, [startRecordingTrigger, isRecording]);
}
