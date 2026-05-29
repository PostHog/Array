export interface IStoragePaths {
  readonly appDataPath: string;
  readonly logsPath: string;
}

export const STORAGE_PATHS_SERVICE = Symbol.for(
  "posthog.platform.storagePaths",
);
