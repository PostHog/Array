import type {
  CommentAnchor,
  HtmlCanvasRect,
} from "@posthog/core/canvas/htmlCanvasSchemas";
import { create } from "zustand";

// A pending comment: the anchor captured in the document plus where its
// affordance/composer should sit (iframe-viewport coords, null for the
// page-level composer which lives in the panel). `composing` flips when the
// user clicks the affordance and the composer opens.
export interface CanvasCommentDraft {
  anchor: CommentAnchor;
  rect: HtmlCanvasRect | null;
  composing: boolean;
}

// View state for HTML-canvas commenting: which panel tab is showing, element
// pick mode, the emphasized thread, the pending draft, and which anchors
// resolved on the last shim repaint. State only — persistence and threading
// live in CanvasCommentsService.
interface CanvasCommentsState {
  panelTab: "main" | "comments";
  pickMode: boolean;
  activeCommentId: string | null;
  draft: CanvasCommentDraft | null;
  resolved: Record<string, boolean>;
  setPanelTab: (tab: "main" | "comments") => void;
  setPickMode: (active: boolean) => void;
  setActiveCommentId: (id: string | null) => void;
  setDraft: (draft: CanvasCommentDraft | null) => void;
  setResolved: (resolved: Record<string, boolean>) => void;
  reset: () => void;
}

const initialState = {
  panelTab: "main" as const,
  pickMode: false,
  activeCommentId: null,
  draft: null,
  resolved: {},
};

export const useCanvasCommentsStore = create<CanvasCommentsState>((set) => ({
  ...initialState,
  setPanelTab: (panelTab) => set({ panelTab }),
  setPickMode: (pickMode) => set({ pickMode }),
  setActiveCommentId: (activeCommentId) => set({ activeCommentId }),
  setDraft: (draft) => set({ draft }),
  setResolved: (resolved) => set({ resolved }),
  reset: () => set(initialState),
}));
