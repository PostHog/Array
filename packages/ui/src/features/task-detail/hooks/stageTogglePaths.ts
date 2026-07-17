import type { ChangedFile } from "@posthog/shared/domain-types";

export function getStageTogglePaths(file: ChangedFile): string[] {
  if (file.originalPath && file.originalPath !== file.path) {
    return [file.originalPath, file.path];
  }

  return [file.path];
}
