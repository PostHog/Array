import { convertStoredEntriesToPortableSessionEvents } from "@posthog/core/sessions/portableSessionEvents";
import type { MobileStoredLogEntry, SessionNotification } from "../types";

export interface ParsedSessionLogs {
  notifications: SessionNotification[];
  rawEntries: MobileStoredLogEntry[];
}

export function parseSessionLogs(content: string): ParsedSessionLogs {
  if (!content?.trim()) {
    return { notifications: [], rawEntries: [] };
  }

  const notifications: SessionNotification[] = [];
  const rawEntries: MobileStoredLogEntry[] = [];

  for (const line of content.trim().split("\n")) {
    try {
      const stored = JSON.parse(line) as MobileStoredLogEntry;

      const msg = stored.notification;
      if (msg) {
        const hasId = msg.id !== undefined;
        const hasMethod = msg.method !== undefined;
        const hasResult = msg.result !== undefined || msg.error !== undefined;

        if (hasId && hasMethod) {
          stored.direction = "client";
        } else if (hasId && hasResult) {
          stored.direction = "agent";
        } else if (hasMethod && !hasId) {
          stored.direction = "agent";
        }
      }

      rawEntries.push(stored);

      if (
        stored.type === "notification" &&
        stored.notification?.method === "session/update" &&
        stored.notification?.params
      ) {
        notifications.push(stored.notification.params as SessionNotification);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { notifications, rawEntries };
}

export const convertStoredEntriesToEvents =
  convertStoredEntriesToPortableSessionEvents;
