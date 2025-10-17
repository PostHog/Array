import { Waveform } from "@phosphor-icons/react";
import { Flex, ScrollArea, Text } from "@radix-ui/themes";
import type { Recording } from "@shared/types";
import { useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useRecordingStore } from "../stores/recordingStore";
import { RecordingListItem } from "./RecordingListItem";

interface RecordingsListProps {
  recordings: Recording[];
  onDelete: (recordingId: string) => void;
}

export function RecordingsList({ recordings, onDelete }: RecordingsListProps) {
  const { selectedRecordingId, setSelectedRecording } = useRecordingStore();
  const selectedIndex = recordings.findIndex(
    (r) => r.id === selectedRecordingId,
  );

  useHotkeys(
    "up",
    (e) => {
      e.preventDefault();
      if (recordings.length === 0) return;

      const newIndex =
        selectedIndex <= 0 ? recordings.length - 1 : selectedIndex - 1;
      setSelectedRecording(recordings[newIndex].id);
    },
    { enableOnFormTags: false },
    [recordings, selectedIndex],
  );

  // Navigate down
  useHotkeys(
    "down",
    (e) => {
      e.preventDefault();
      if (recordings.length === 0) return;

      const newIndex =
        selectedIndex >= recordings.length - 1 ? 0 : selectedIndex + 1;
      setSelectedRecording(recordings[newIndex].id);
    },
    { enableOnFormTags: false },
    [recordings, selectedIndex],
  );

  // Delete selected recording
  useHotkeys(
    "delete,backspace",
    (e) => {
      e.preventDefault();
      if (!selectedRecordingId) return;

      if (confirm("Delete this recording?")) {
        // Calculate next selection before deletion
        const remainingCount = recordings.length - 1;

        if (remainingCount > 0) {
          // Find next recording to select (prefer next, fallback to previous)
          const nextIndex =
            selectedIndex < remainingCount ? selectedIndex : remainingCount - 1;

          // Find the recording at the calculated index, excluding the one being deleted
          const nextRecording = recordings.find(
            (_r, idx) => idx !== selectedIndex && idx === nextIndex,
          );

          if (nextRecording) {
            setSelectedRecording(nextRecording.id);
          } else {
            // Fallback: select any recording that isn't being deleted
            const fallbackRecording = recordings.find(
              (r) => r.id !== selectedRecordingId,
            );
            setSelectedRecording(fallbackRecording?.id || null);
          }
        } else {
          setSelectedRecording(null);
        }

        // Perform deletion after calculating next selection
        onDelete(selectedRecordingId);
      }
    },
    { enableOnFormTags: false },
    [selectedRecordingId, selectedIndex, recordings, onDelete],
  );

  // Open detail view with Enter
  useHotkeys(
    "enter",
    (e) => {
      e.preventDefault();
      // Detail view is always visible in split view, so Enter just selects if not selected
      if (recordings.length > 0 && !selectedRecordingId) {
        setSelectedRecording(recordings[0].id);
      }
    },
    { enableOnFormTags: false },
    [recordings, selectedRecordingId],
  );

  // Auto-select first recording if none selected
  useEffect(() => {
    if (recordings.length > 0 && !selectedRecordingId) {
      setSelectedRecording(recordings[0].id);
    } else if (recordings.length === 0) {
      setSelectedRecording(null);
    }
  }, [recordings, selectedRecordingId, setSelectedRecording]);

  if (recordings.length === 0) {
    return (
      <Flex
        direction="column"
        align="center"
        justify="center"
        style={{ height: "100%", padding: "32px" }}
        gap="3"
      >
        <Waveform size={48} weight="thin" style={{ opacity: 0.3 }} />
        <Text size="2" color="gray" align="center">
          No recordings yet.
          <br />
          Press <kbd>R</kbd> to start.
        </Text>
      </Flex>
    );
  }

  return (
    <ScrollArea>
      <Flex direction="column">
        {recordings.map((recording) => (
          <RecordingListItem
            key={recording.id}
            recording={recording}
            isSelected={recording.id === selectedRecordingId}
            onClick={() => setSelectedRecording(recording.id)}
          />
        ))}
      </Flex>
    </ScrollArea>
  );
}
