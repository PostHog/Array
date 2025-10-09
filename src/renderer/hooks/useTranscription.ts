import type { Recording } from "@shared/types";
import { useState } from "react";

export function useTranscription() {
  const [transcribingId, setTranscribingId] = useState<string | null>(null);

  const handleTranscribe = async (
    recording: Recording,
    openaiApiKey: string,
    onSuccess?: (updatedRecording: Recording) => void,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!openaiApiKey) {
      return {
        success: false,
        error: "OpenAI API key not configured. Please add it in Sources.",
      };
    }

    try {
      setTranscribingId(recording.id);

      await window.electronAPI.recordingTranscribe(recording.id, openaiApiKey);

      // Reload recordings to get updated transcription and summary
      const updatedRecordings = await window.electronAPI.recordingList();
      const updatedRecording = updatedRecordings.find(
        (r) => r.id === recording.id,
      );

      console.log("Updated recording after transcription:", updatedRecording);
      console.log("Summary:", updatedRecording?.transcription?.summary);

      if (updatedRecording && onSuccess) {
        onSuccess(updatedRecording);
      }

      return { success: true };
    } catch (err) {
      console.error("Failed to transcribe:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);

      let error: string;
      if (errorMessage.includes("quota") || errorMessage.includes("429")) {
        error =
          "OpenAI quota exceeded. Please check your billing at platform.openai.com/account/billing";
      } else if (
        errorMessage.includes("401") ||
        errorMessage.includes("authentication")
      ) {
        error = "Invalid OpenAI API key. Please update it in Sources.";
      } else {
        error = `Failed to transcribe: ${errorMessage}`;
      }

      return { success: false, error };
    } finally {
      setTranscribingId(null);
    }
  };

  return {
    transcribingId,
    handleTranscribe,
  };
}
