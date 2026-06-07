import type {
  AnalyticsProperties,
  IAnalytics,
} from "@posthog/platform/analytics";
import { PostHog } from "posthog-node";
import { getAppVersion } from "../utils/env";
import { uuidv7 } from "../utils/uuidv7";

export class PosthogNodeAnalytics implements IAnalytics {
  private client: PostHog | null = null;
  private currentUserId: string | null = null;
  private sessionId: string | null = null;

  initialize(): void {
    if (this.client) {
      return;
    }

    const apiKey = process.env.VITE_POSTHOG_API_KEY;
    const apiHost = process.env.VITE_POSTHOG_API_HOST;

    if (!apiKey) {
      return;
    }

    this.client = new PostHog(apiKey, {
      host: apiHost || "https://internal-c.posthog.com",
      enableExceptionAutocapture: true,
    });

    // Mint the main-owned session id now, before the first window, so crash
    // handlers can stamp $session_id even when the renderer crashes during
    // startup (before it fetches the id to bootstrap posthog-js).
    this.getOrCreateSessionId();
  }

  setCurrentUserId(userId: string | null): void {
    this.currentUserId = userId;
  }

  getCurrentUserId(): string | null {
    return this.currentUserId;
  }

  /**
   * The PostHog session id is OWNED BY MAIN. Main mints one UUIDv7 and every
   * renderer window bootstraps posthog-js with it (`bootstrap.sessionID`).
   * Because main outlives the renderer, the id stays stable across a renderer
   * crash + reload, so the replay is one continuous session spanning the crash
   * and main-captured crash events (the renderer can't report its own OOM)
   * always carry the right `$session_id` with no race or hand-off.
   *
   * Minted lazily on first request (a window asks at boot, before posthog-js
   * init) so its UUIDv7 timestamp precedes the session's first event, as
   * posthog-js requires.
   */
  getOrCreateSessionId(): string {
    if (!this.sessionId) {
      this.sessionId = uuidv7();
    }
    return this.sessionId;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  track(eventName: string, properties?: AnalyticsProperties): void {
    if (!this.client) {
      return;
    }

    const distinctId = this.currentUserId || "anonymous-app-event";

    this.client.capture({
      distinctId,
      event: eventName,
      properties: {
        team: "posthog-code",
        ...properties,
        app_version: getAppVersion(),
        $process_person_profile: !!this.currentUserId,
      },
    });
  }

  identify(userId: string, properties?: AnalyticsProperties): void {
    if (!this.client) {
      return;
    }

    this.currentUserId = userId;

    this.client.identify({
      distinctId: userId,
      properties,
    });
  }

  resetUser(): void {
    this.currentUserId = null;
  }

  captureException(
    error: unknown,
    additionalProperties?: Record<string, unknown>,
  ): void {
    if (!this.client) {
      return;
    }

    const distinctId = this.currentUserId || "anonymous-app-event";
    this.client.captureException(error, distinctId, {
      team: "posthog-code",
      ...additionalProperties,
      // System-owned fields last so callers can't overwrite them: main owns
      // the session id used for crash->replay linking.
      ...(this.sessionId ? { $session_id: this.sessionId } : {}),
      app_version: getAppVersion(),
    });
  }

  async flush(): Promise<void> {
    await this.client?.flush();
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.shutdown();
      this.client = null;
    }
  }
}

export const posthogNodeAnalytics = new PosthogNodeAnalytics();
