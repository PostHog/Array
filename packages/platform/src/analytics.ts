export type AnalyticsProperties = Record<string, string | number | boolean>;

export interface IAnalytics {
  initialize(): void;
  track(eventName: string, properties?: AnalyticsProperties): void;
  identify(userId: string, properties?: AnalyticsProperties): void;
  setCurrentUserId(userId: string | null): void;
  getCurrentUserId(): string | null;
  /**
   * Stable analytics session id owned by the host process. Minted lazily on
   * first request so renderer windows can bootstrap posthog-js with it and
   * host-captured crash events link to the same replay session.
   */
  getOrCreateSessionId(): string;
  getSessionId(): string | null;
  resetUser(): void;
  captureException(
    error: unknown,
    additionalProperties?: Record<string, unknown>,
  ): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export const ANALYTICS_SERVICE = Symbol.for("posthog.platform.analytics");
