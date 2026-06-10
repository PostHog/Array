import {
  SITUATION_IDS,
  type SituationId,
  type ValidationDiagnostic,
  type WorkflowAction,
  type WorkflowBindings,
  type WorkflowConfig,
  type WorkflowDraft,
} from "@posthog/core/workflow/schemas";
import { create } from "zustand";

// Uncommitted editor state for the Config view — the in-flight draft, dirty
// flag, and diagnostics. The persisted workflow lives in the tRPC query cache.
export type Selection =
  | { kind: "action"; situationId: SituationId; actionId: string }
  | { kind: "situation"; situationId: SituationId }
  | null;

interface WorkflowEditorStore {
  draft: WorkflowDraft | null;
  baselineSerialized: string | null;
  dirty: boolean;
  diagnostics: ValidationDiagnostic[];
  selection: Selection;

  beginEdit(persisted: WorkflowConfig): void;
  addAction(situation: SituationId, action: WorkflowAction): void;
  updateAction(
    situation: SituationId,
    actionId: string,
    patch: Partial<WorkflowAction>,
  ): void;
  removeAction(situation: SituationId, actionId: string): void;
  moveAction(
    situation: SituationId,
    actionId: string,
    direction: "up" | "down",
  ): void;
  setDiagnostics(diagnostics: ValidationDiagnostic[]): void;
  selectAction(ref: Extract<Selection, { kind: "action" }> | null): void;
  selectSituation(id: SituationId | null): void;
  clearSelection(): void;
}

function serialize(draft: WorkflowDraft): string {
  return JSON.stringify(draft.bindings);
}

function toDraft(config: WorkflowConfig): WorkflowDraft {
  // Normalize bindings to cover every situation key (z.record allows partial
  // maps) so consumers can read `bindings[sid]` without optional-chaining.
  const bindings = Object.fromEntries(
    SITUATION_IDS.map((sid) => [sid, config.bindings[sid] ?? []]),
  ) as WorkflowBindings;
  return {
    id: config.id,
    version: config.version,
    bindings,
  };
}

function commit(
  set: (partial: Partial<WorkflowEditorStore>) => void,
  next: WorkflowDraft,
  baseline: string | null,
) {
  set({
    draft: next,
    dirty: baseline !== null && serialize(next) !== baseline,
  });
}

export const useWorkflowEditorStore = create<WorkflowEditorStore>(
  (set, get) => ({
    draft: null,
    baselineSerialized: null,
    dirty: false,
    diagnostics: [],
    selection: null,

    beginEdit(persisted) {
      const draft = toDraft(persisted);
      set({
        draft,
        baselineSerialized: serialize(draft),
        dirty: false,
        diagnostics: [],
        selection: null,
      });
    },

    addAction(situation, action) {
      const { draft, baselineSerialized } = get();
      if (!draft) return;
      const current = draft.bindings[situation] ?? [];
      const bindings = {
        ...draft.bindings,
        [situation]: [...current, action],
      };
      commit(set, { ...draft, bindings }, baselineSerialized);
    },

    updateAction(situation, actionId, patch) {
      const { draft, baselineSerialized } = get();
      if (!draft) return;
      const current = draft.bindings[situation] ?? [];
      const next = current.map((a) =>
        a.id === actionId ? { ...a, ...patch } : a,
      );
      const bindings = { ...draft.bindings, [situation]: next };
      commit(set, { ...draft, bindings }, baselineSerialized);
    },

    removeAction(situation, actionId) {
      const { draft, baselineSerialized } = get();
      if (!draft) return;
      const current = draft.bindings[situation] ?? [];
      const next = current.filter((a) => a.id !== actionId);
      const bindings = { ...draft.bindings, [situation]: next };
      commit(set, { ...draft, bindings }, baselineSerialized);
    },

    moveAction(situation, actionId, direction) {
      const { draft, baselineSerialized } = get();
      if (!draft) return;
      const current = draft.bindings[situation] ?? [];
      const idx = current.findIndex((a) => a.id === actionId);
      if (idx === -1) return;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= current.length) return;
      const next = [...current];
      const [removed] = next.splice(idx, 1);
      if (!removed) return;
      next.splice(target, 0, removed);
      const bindings = { ...draft.bindings, [situation]: next };
      commit(set, { ...draft, bindings }, baselineSerialized);
    },

    setDiagnostics(diagnostics) {
      set({ diagnostics });
    },
    selectAction(ref) {
      set({ selection: ref });
    },
    selectSituation(id) {
      set({
        selection: id === null ? null : { kind: "situation", situationId: id },
      });
    },
    clearSelection() {
      set({ selection: null });
    },
  }),
);
