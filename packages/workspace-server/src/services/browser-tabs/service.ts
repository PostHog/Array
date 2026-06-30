import {
  type BrowserWindow,
  closeTab,
  newBlankTab,
  openOrFocusTab,
  reorderTab,
  setTabTarget,
  type TabsSnapshot,
  type TabTarget,
  TypedEventEmitter,
} from "@posthog/shared";
import { inject, injectable } from "inversify";
import { BROWSER_TABS_REPOSITORY } from "../../db/identifiers";
import type { IBrowserTabsRepository } from "../../db/repositories/browser-tabs-repository";
import { BrowserTabsEvent, type BrowserTabsEvents } from "./schemas";

const makeId = () => crypto.randomUUID();
const now = () => Date.now();

export interface IBrowserTabsService {
  getSnapshot(): TabsSnapshot;
  getPrimaryWindowId(): string;
  openOrFocus(
    input: TabTarget & {
      windowId: string;
      channelId: string | null;
      channelSection?: string | null;
    },
  ): TabsSnapshot;
  newBlankTab(input: { windowId: string }): TabsSnapshot;
  setTabTarget(
    input: TabTarget & {
      tabId: string;
      channelId: string | null;
      channelSection?: string | null;
    },
  ): TabsSnapshot;
  close(tabId: string): TabsSnapshot;
  reorder(input: { tabId: string; toIndex: number }): TabsSnapshot;
  setActiveTab(input: { windowId: string; tabId: string | null }): TabsSnapshot;
  snapshotChangeEvents(
    signal: AbortSignal | undefined,
  ): AsyncIterable<TabsSnapshot>;
}

/**
 * Authoritative, single-instance owner of the Channels browser-tab strips.
 * Lives in the shared main process so every renderer window reads and mutates
 * one source of truth; changes fan out to all windows via the snapshot-change
 * subscription. Durable state is persisted through the repository; the
 * back/forward action timeline is per-renderer and lives in the UI, not here.
 */
@injectable()
export class BrowserTabsService
  extends TypedEventEmitter<BrowserTabsEvents>
  implements IBrowserTabsService
{
  private snapshot: TabsSnapshot;

  constructor(
    @inject(BROWSER_TABS_REPOSITORY)
    private readonly repo: IBrowserTabsRepository,
  ) {
    super();
    this.setMaxListeners(0);
    const loaded = this.repo.load();
    const seeded = this.ensurePrimaryWindow(loaded);
    if (seeded !== loaded) this.repo.save(seeded);
    this.snapshot = seeded;
  }

  /** Guarantee a primary window exists so the first open has somewhere to land. */
  private ensurePrimaryWindow(snapshot: TabsSnapshot): TabsSnapshot {
    if (snapshot.windows.some((w) => w.isPrimary)) return snapshot;
    const primary: BrowserWindow = {
      id: makeId(),
      isPrimary: true,
      bounds: null,
      activeTabId: null,
    };
    return { ...snapshot, windows: [primary, ...snapshot.windows] };
  }

  getSnapshot(): TabsSnapshot {
    return this.snapshot;
  }

  /** Id of the primary window — the default target before multi-window. */
  getPrimaryWindowId(): string {
    const primary = this.snapshot.windows.find((w) => w.isPrimary);
    if (!primary) throw new Error("browser-tabs: no primary window");
    return primary.id;
  }

  openOrFocus(
    input: TabTarget & {
      windowId: string;
      channelId: string | null;
      channelSection?: string | null;
    },
  ): TabsSnapshot {
    const { snapshot } = openOrFocusTab(this.snapshot, {
      ...input,
      makeId,
      now,
    });
    return this.commit(snapshot);
  }

  newBlankTab(input: { windowId: string }): TabsSnapshot {
    const { snapshot } = newBlankTab(this.snapshot, {
      windowId: input.windowId,
      makeId,
      now,
    });
    return this.commit(snapshot);
  }

  setTabTarget(
    input: TabTarget & {
      tabId: string;
      channelId: string | null;
      channelSection?: string | null;
    },
  ): TabsSnapshot {
    return this.commit(setTabTarget(this.snapshot, { ...input, now }));
  }

  close(tabId: string): TabsSnapshot {
    const { snapshot } = closeTab(this.snapshot, tabId);
    return this.commit(snapshot);
  }

  reorder(input: { tabId: string; toIndex: number }): TabsSnapshot {
    return this.commit(reorderTab(this.snapshot, input.tabId, input.toIndex));
  }

  setActiveTab(input: {
    windowId: string;
    tabId: string | null;
  }): TabsSnapshot {
    const next: TabsSnapshot = {
      ...this.snapshot,
      windows: this.snapshot.windows.map((w) =>
        w.id === input.windowId ? { ...w, activeTabId: input.tabId } : w,
      ),
    };
    return this.commit(next);
  }

  snapshotChangeEvents(
    signal: AbortSignal | undefined,
  ): AsyncIterable<TabsSnapshot> {
    return this.toIterable(BrowserTabsEvent.SnapshotChange, { signal });
  }

  private commit(next: TabsSnapshot): TabsSnapshot {
    this.snapshot = next;
    this.repo.save(next);
    this.emit(BrowserTabsEvent.SnapshotChange, next);
    return next;
  }
}
