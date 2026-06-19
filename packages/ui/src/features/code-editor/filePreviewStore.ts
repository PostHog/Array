import type { RenderableKind } from "@posthog/core/code-editor/fileKind";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// Per renderable file kind, whether files open as a rendered preview (vs raw
// source). The preference is global per kind and persisted, so a user who
// prefers source mode keeps it across files and sessions.
interface FilePreviewStoreState {
  renderPreview: Record<RenderableKind, boolean>;
}

interface FilePreviewStoreActions {
  toggleKind: (kind: RenderableKind) => void;
}

type FilePreviewStore = FilePreviewStoreState & FilePreviewStoreActions;

export const useFilePreviewStore = create<FilePreviewStore>()(
  persist(
    (set) => ({
      renderPreview: { markdown: true, html: true },
      toggleKind: (kind) =>
        set((s) => ({
          renderPreview: { ...s.renderPreview, [kind]: !s.renderPreview[kind] },
        })),
    }),
    {
      name: "file-preview-storage",
    },
  ),
);
