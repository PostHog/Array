import type { Contribution } from "@posthog/di/contribution";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { logger } from "@posthog/ui/shell/logger";
import { inject, injectable } from "inversify";

const log = logger.scope("custom-instructions-sync");

/**
 * Mirrors the user-level AGENTS.md/CLAUDE.md into personalization while the
 * "sync from file" setting is on: reads the file once settings hydrate at
 * boot, and again whenever the toggle flips. The store only holds the snapshot
 * (AGENTS.md forbids stores owning I/O); this contribution owns the read.
 */
@injectable()
export class CustomInstructionsSyncContribution implements Contribution {
  constructor(
    @inject(HOST_TRPC_CLIENT)
    private readonly hostClient: HostTrpcClient,
  ) {}

  start(): void {
    const initial = useSettingsStore.getState();
    if (initial._hasHydrated) {
      void this.reconcile(initial.syncCustomInstructionsFromFile);
    }
    useSettingsStore.subscribe((state, prev) => {
      const becameHydrated = state._hasHydrated && !prev._hasHydrated;
      const toggleFlipped =
        state.syncCustomInstructionsFromFile !==
        prev.syncCustomInstructionsFromFile;
      if (becameHydrated || (state._hasHydrated && toggleFlipped)) {
        void this.reconcile(state.syncCustomInstructionsFromFile);
      }
    });
  }

  private async reconcile(enabled: boolean): Promise<void> {
    if (!enabled) {
      useSettingsStore.getState().setSyncedCustomInstructions(null);
      return;
    }
    try {
      const file = await this.hostClient.os.getUserAgentInstructions.query();
      useSettingsStore.getState().setSyncedCustomInstructions(file);
    } catch (err) {
      // Keep the last snapshot; sessions fall back to the hand-typed
      // instructions when none exists.
      log.warn("Failed to read user agent instructions file", err);
    }
  }
}
