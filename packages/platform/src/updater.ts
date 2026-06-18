export interface IUpdater {
  isSupported(): boolean;
  setFeedUrl(url: string): void;
  check(): void;
  quitAndInstall(): void;
  onCheckStart(handler: () => void): () => void;
  onUpdateAvailable(handler: () => void): () => void;
  onUpdateDownloaded(handler: (version: string) => void): () => void;
  onNoUpdate(handler: () => void): () => void;
  onError(handler: (error: Error) => void): () => void;
}

export const UPDATER_SERVICE = Symbol.for("posthog.platform.updater");
