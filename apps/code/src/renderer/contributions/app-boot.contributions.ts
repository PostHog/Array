import type { Contribution } from "@posthog/di/contribution";
import {
  initializePostHog,
  registerAppVersion,
} from "@posthog/ui/shell/posthogAnalyticsImpl";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { injectable } from "inversify";

const log = logger.scope("app-boot");

@injectable()
export class AnalyticsBootContribution implements Contribution {
  start(): void {
    // Fetch the main-owned session id BEFORE initializing posthog-js so the
    // recording shares the id main stamps on crash events. Init is gated on it
    // so the id is set before the first event (posthog-js requires the
    // bootstrap id's timestamp to precede the session's first event).
    void (async () => {
      let sessionId: string | undefined;
      try {
        ({ sessionId } = await trpcClient.analytics.getSessionId.query());
      } catch (error) {
        log.warn("Failed to fetch session id from main", { error });
      }
      initializePostHog(sessionId);
      trpcClient.os.getAppVersion
        .query()
        .then(registerAppVersion)
        .catch((error) => {
          log.warn("Failed to register app version super property", { error });
        });
    })();
  }
}

@injectable()
export class InboxDemoDevContribution implements Contribution {
  start(): void {
    if (import.meta.env.PROD) {
      return;
    }
    void import("@posthog/ui/features/inbox/devtools/inboxDemoConsole").then(
      ({ registerInboxDemoConsoleCommand }) => {
        registerInboxDemoConsoleCommand();
      },
    );
  }
}
