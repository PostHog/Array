interface Subscriber<T> {
  onData: (data: T) => void;
  onError?: (error: unknown) => void;
}

export interface ConnectivityStatusPayload {
  isOnline: boolean;
}

export interface ConnectivityClient {
  getStatus(): Promise<ConnectivityStatusPayload>;
  /** Forces an immediate reachability probe; backs the banner's Retry. */
  checkNow(): Promise<ConnectivityStatusPayload>;
  onStatusChange(sub: Subscriber<ConnectivityStatusPayload>): {
    unsubscribe: () => void;
  };
}

export const CONNECTIVITY_CLIENT = Symbol.for("posthog.ui.ConnectivityClient");
