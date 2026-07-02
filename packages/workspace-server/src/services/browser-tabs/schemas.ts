import { type TabsSnapshot, tabsSnapshotSchema } from "@posthog/shared";
import { z } from "zod";

/** tRPC output: the full durable tab/window snapshot. */
export const browserTabsSnapshotOutput = tabsSnapshotSchema;

export const openOrFocusTabInput = z.object({
  windowId: z.string(),
  dashboardId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  channelId: z.string().nullable().default(null),
  channelSection: z.string().nullable().default(null),
});

export const newBlankTabInput = z.object({ windowId: z.string() });

export const setTabTargetInput = z.object({
  tabId: z.string(),
  dashboardId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  channelId: z.string().nullable().default(null),
  channelSection: z.string().nullable().default(null),
});

export const closeTabInput = z.object({ tabId: z.string() });

export const closeTabsInput = z.object({
  tabIds: z.array(z.string()),
  // The bulk close's anchor (the right-clicked tab, which always survives);
  // focus falls to it when the active tab is among those closed.
  focusTabId: z.string().nullable().default(null),
});

export const setTabOrderInput = z.object({
  windowId: z.string(),
  tabIds: z.array(z.string()),
});

export const setActiveTabInput = z.object({
  windowId: z.string(),
  tabId: z.string().nullable(),
});

export enum BrowserTabsEvent {
  SnapshotChange = "snapshotChange",
}

export type BrowserTabsEvents = {
  [BrowserTabsEvent.SnapshotChange]: TabsSnapshot;
};
