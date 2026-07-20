import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Which mentions the viewer has read.
 *
 * A mention is read by opening its thread — not by opening the Activity page,
 * which is a list of things you haven't dealt with yet, not a receipt for them.
 *
 * `lastSeenAt` is the watermark from when the page itself marked everything
 * seen. It's no longer written, only read: it keeps mentions from before the
 * switch to per-mention tracking from resurfacing as unread. New mentions are
 * unread until their thread is opened.
 */
interface ActivitySeenState {
  lastSeenAt: string | null;
  readMessageIds: Set<string>;
  markMessageRead: (messageId: string) => void;
}

const MAX_READ_IDS = 500;

export const useActivitySeenStore = create<ActivitySeenState>()(
  persist(
    (set) => ({
      lastSeenAt: null,
      readMessageIds: new Set<string>(),
      markMessageRead: (messageId) =>
        set((state) => {
          if (state.readMessageIds.has(messageId)) return state;
          const next = new Set(state.readMessageIds);
          next.add(messageId);
          // The mentions feed itself is capped, so unbounded read ids would
          // outlive anything that could reference them. Oldest out first.
          if (next.size > MAX_READ_IDS) {
            const excess = next.size - MAX_READ_IDS;
            const ids = next.values();
            for (let i = 0; i < excess; i++) {
              const oldest = ids.next().value;
              if (oldest !== undefined) next.delete(oldest);
            }
          }
          return { readMessageIds: next };
        }),
    }),
    {
      name: "channels-activity-seen",
      storage: electronStorage,
      // Sets don't survive JSON; store the ids as an array and rebuild on load.
      partialize: (state) => ({
        lastSeenAt: state.lastSeenAt,
        readMessageIds: [...state.readMessageIds],
      }),
      merge: (persisted, current) => {
        const saved = persisted as
          | { lastSeenAt?: string | null; readMessageIds?: string[] }
          | undefined;
        return {
          ...current,
          lastSeenAt: saved?.lastSeenAt ?? current.lastSeenAt,
          readMessageIds: new Set(saved?.readMessageIds ?? []),
        };
      },
    },
  ),
);
