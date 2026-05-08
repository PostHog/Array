import { z } from "zod";

export const isEnabledOutput = z.object({
  enabled: z.boolean(),
});

export const checkErrorCode = z.enum(["already_checking", "disabled"]);
export type CheckErrorCode = z.infer<typeof checkErrorCode>;

export const checkForUpdatesOutput = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
  errorCode: checkErrorCode.optional(),
});

export const installUpdateOutput = z.object({
  installed: z.boolean(),
});

export const autoDownloadUpdatesOutput = z.object({
  enabled: z.boolean(),
});

export const setAutoDownloadUpdatesInput = z.object({
  enabled: z.boolean(),
});

export type IsEnabledOutput = z.infer<typeof isEnabledOutput>;

export type CheckForUpdatesOutput = z.infer<typeof checkForUpdatesOutput>;
export type InstallUpdateOutput = z.infer<typeof installUpdateOutput>;
export type AutoDownloadUpdatesOutput = z.infer<
  typeof autoDownloadUpdatesOutput
>;
export type SetAutoDownloadUpdatesInput = z.infer<
  typeof setAutoDownloadUpdatesInput
>;

export const UpdatesEvent = {
  Ready: "ready",
  Status: "status",
  CheckFromMenu: "check-from-menu",
} as const;

export type UpdatesStatusPayload = {
  checking: boolean;
  downloading?: boolean;
  upToDate?: boolean;
  updateReady?: boolean;
  version?: string;
  error?: string;
};

export type UpdateReadyPayload = {
  version: string | null;
};

export interface UpdatesEvents {
  [UpdatesEvent.Ready]: UpdateReadyPayload;
  [UpdatesEvent.Status]: UpdatesStatusPayload;
  [UpdatesEvent.CheckFromMenu]: true;
}
