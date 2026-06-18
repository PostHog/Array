import type { FileAttachment } from "@posthog/core/message-editor/content";
import {
  type PersistedFile,
  persistBrowserFile as persistBrowserFileCore,
  persistGenericFile as persistGenericFileCore,
  persistImageFile as persistImageFileCore,
  persistImageFilePath as persistImageFilePathCore,
  persistTextContent as persistTextContentCore,
  resolveDroppedFile as resolveDroppedFileCore,
} from "@posthog/core/message-editor/persistFile";
import { toast } from "@posthog/ui/primitives/toast";
import { getFilePath } from "@posthog/ui/utils/getFilePath";
import { filePersistHost } from "../hostApi";

export type { PersistedFile };

function host() {
  return filePersistHost;
}

export function persistImageFile(file: File): Promise<PersistedFile> {
  return persistImageFileCore(host(), file);
}

export function persistTextContent(
  text: string,
  originalName?: string,
): Promise<PersistedFile> {
  return persistTextContentCore(host(), text, originalName);
}

export function persistGenericFile(file: File): Promise<PersistedFile> {
  return persistGenericFileCore(host(), file);
}

export function persistImageFilePath(
  filePath: string,
): Promise<{ id: string; label: string }> {
  return persistImageFilePathCore(host(), filePath);
}

export function resolveDroppedFile(file: File): Promise<FileAttachment | null> {
  return resolveDroppedFileCore(host(), file, getFilePath(file), {
    onDownscaleFailed: () =>
      toast.warning("Image could not be downscaled", {
        description: "Attaching original file instead",
      }),
  });
}

export async function resolveAndAttachDroppedFiles(
  files: FileList,
  addAttachment: (attachment: FileAttachment) => void,
): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    const attachment = await resolveDroppedFile(files[i]);
    if (attachment) addAttachment(attachment);
  }
}

export function persistBrowserFile(
  file: File,
): Promise<{ id: string; label: string }> {
  return persistBrowserFileCore(host(), file);
}
