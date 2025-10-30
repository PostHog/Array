import type { DesktopRecording } from "@renderer/features/notetaker/hooks/useDesktopRecordings";
import { useDesktopRecordings } from "@renderer/features/notetaker/hooks/useDesktopRecordings";
import type { ActiveRecording } from "@renderer/stores/activeRecordingStore";
import { useActiveRecordingStore } from "@renderer/stores/activeRecordingStore";
import { useMemo } from "react";

export type RecordingItem =
  | { type: "active"; recording: ActiveRecording }
  | { type: "past"; recording: DesktopRecording };

export function useAllRecordings() {
  const activeRecordings = useActiveRecordingStore(
    (state) => state.activeRecordings,
  );
  const { recordings: pastRecordings, isLoading } = useDesktopRecordings();

  const allRecordings = useMemo<RecordingItem[]>(
    () => [
      ...activeRecordings.map(
        (r): RecordingItem => ({ type: "active", recording: r }),
      ),
      ...pastRecordings
        .filter((r) => r.status === "ready")
        .map((r): RecordingItem => ({ type: "past", recording: r })),
    ],
    [activeRecordings, pastRecordings],
  );

  return {
    activeRecordings,
    pastRecordings,
    allRecordings,
    isLoading,
  };
}
