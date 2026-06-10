import {
  SITUATION_IDS,
  type WorkflowAction,
  type WorkflowBindings,
  type WorkflowConfig,
} from "@posthog/core/workflow/schemas";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkflowEditorStore } from "./workflowEditorStore";

function makeAction(overrides: Partial<WorkflowAction> = {}): WorkflowAction {
  return {
    id: "action_1",
    label: "Review",
    skillId: "review",
    prompt: "Review the diff",
    ...overrides,
  };
}

function makeConfig(bindings: Partial<WorkflowBindings> = {}): WorkflowConfig {
  return {
    id: "wf_1",
    version: 3,
    updatedAt: "2026-01-01T00:00:00Z",
    bindings: bindings as WorkflowBindings,
  };
}

function resetStore() {
  useWorkflowEditorStore.setState({
    draft: null,
    baselineSerialized: null,
    dirty: false,
    diagnostics: [],
    selection: null,
  });
}

const store = () => useWorkflowEditorStore.getState();

describe("workflowEditorStore", () => {
  beforeEach(() => {
    resetStore();
  });

  describe("beginEdit", () => {
    it("normalizes bindings so every situation key is present", () => {
      store().beginEdit(makeConfig({ working: [makeAction()] }));
      const { draft } = store();
      expect(draft).not.toBeNull();
      expect(Object.keys(draft?.bindings ?? {}).sort()).toEqual(
        [...SITUATION_IDS].sort(),
      );
      expect(draft?.bindings.working).toHaveLength(1);
      expect(draft?.bindings.in_review).toEqual([]);
    });

    it("drops updatedAt and preserves id and version", () => {
      store().beginEdit(makeConfig());
      const { draft } = store();
      expect(draft?.id).toBe("wf_1");
      expect(draft?.version).toBe(3);
      expect("updatedAt" in (draft ?? {})).toBe(false);
    });

    it("starts clean with no dirty flag, diagnostics, or selection", () => {
      useWorkflowEditorStore.setState({
        dirty: true,
        diagnostics: [
          { severity: "error", code: "action_empty_label", message: "x" },
        ],
        selection: { kind: "situation", situationId: "working" },
      });
      store().beginEdit(makeConfig({ working: [makeAction()] }));
      expect(store().dirty).toBe(false);
      expect(store().diagnostics).toEqual([]);
      expect(store().selection).toBeNull();
    });
  });

  describe("mutations are no-ops before beginEdit", () => {
    it("addAction does nothing while draft is null", () => {
      store().addAction("working", makeAction());
      expect(store().draft).toBeNull();
    });
  });

  describe("addAction", () => {
    it("appends to the target situation and marks dirty", () => {
      store().beginEdit(makeConfig({ working: [makeAction({ id: "a" })] }));
      store().addAction("working", makeAction({ id: "b" }));
      expect(store().draft?.bindings.working.map((a) => a.id)).toEqual([
        "a",
        "b",
      ]);
      expect(store().dirty).toBe(true);
    });

    it("does not touch other situations", () => {
      store().beginEdit(makeConfig({ in_review: [makeAction({ id: "x" })] }));
      store().addAction("working", makeAction({ id: "y" }));
      expect(store().draft?.bindings.in_review.map((a) => a.id)).toEqual(["x"]);
    });
  });

  describe("updateAction", () => {
    it("patches the matching action", () => {
      store().beginEdit(makeConfig({ working: [makeAction({ id: "a" })] }));
      store().updateAction("working", "a", { label: "Renamed" });
      expect(store().draft?.bindings.working[0].label).toBe("Renamed");
      expect(store().dirty).toBe(true);
    });

    it("is a no-op for an unknown action id", () => {
      store().beginEdit(makeConfig({ working: [makeAction({ id: "a" })] }));
      store().updateAction("working", "missing", { label: "Renamed" });
      expect(store().draft?.bindings.working[0].label).toBe("Review");
      expect(store().dirty).toBe(false);
    });
  });

  describe("removeAction", () => {
    it("removes only the targeted action", () => {
      store().beginEdit(
        makeConfig({
          working: [makeAction({ id: "a" }), makeAction({ id: "b" })],
        }),
      );
      store().removeAction("working", "a");
      expect(store().draft?.bindings.working.map((act) => act.id)).toEqual([
        "b",
      ]);
    });
  });

  describe("moveAction", () => {
    it("does nothing when moving the first item up", () => {
      store().beginEdit(
        makeConfig({
          working: [makeAction({ id: "a" }), makeAction({ id: "b" })],
        }),
      );
      store().moveAction("working", "a", "up");
      expect(store().draft?.bindings.working.map((act) => act.id)).toEqual([
        "a",
        "b",
      ]);
      expect(store().dirty).toBe(false);
    });

    it("does nothing when moving the last item down", () => {
      store().beginEdit(
        makeConfig({
          working: [makeAction({ id: "a" }), makeAction({ id: "b" })],
        }),
      );
      store().moveAction("working", "b", "down");
      expect(store().draft?.bindings.working.map((act) => act.id)).toEqual([
        "a",
        "b",
      ]);
      expect(store().dirty).toBe(false);
    });

    it("swaps an adjacent pair in the middle of the list", () => {
      store().beginEdit(
        makeConfig({
          working: [
            makeAction({ id: "a" }),
            makeAction({ id: "b" }),
            makeAction({ id: "c" }),
          ],
        }),
      );
      store().moveAction("working", "b", "down");
      expect(store().draft?.bindings.working.map((act) => act.id)).toEqual([
        "a",
        "c",
        "b",
      ]);
      expect(store().dirty).toBe(true);
    });

    it("is a no-op for an unknown action id", () => {
      store().beginEdit(makeConfig({ working: [makeAction({ id: "a" })] }));
      store().moveAction("working", "missing", "down");
      expect(store().dirty).toBe(false);
    });
  });

  describe("dirty flag", () => {
    it("returns to false after a change is reverted to baseline", () => {
      store().beginEdit(makeConfig({ working: [makeAction({ id: "a" })] }));
      store().addAction("working", makeAction({ id: "b" }));
      expect(store().dirty).toBe(true);
      store().removeAction("working", "b");
      expect(store().dirty).toBe(false);
    });
  });

  describe("selection", () => {
    it("round-trips action, situation, and clear", () => {
      store().selectAction({
        kind: "action",
        situationId: "working",
        actionId: "a",
      });
      expect(store().selection).toEqual({
        kind: "action",
        situationId: "working",
        actionId: "a",
      });

      store().selectSituation("in_review");
      expect(store().selection).toEqual({
        kind: "situation",
        situationId: "in_review",
      });

      store().selectSituation(null);
      expect(store().selection).toBeNull();

      store().selectAction({
        kind: "action",
        situationId: "working",
        actionId: "a",
      });
      store().clearSelection();
      expect(store().selection).toBeNull();
    });
  });
});
