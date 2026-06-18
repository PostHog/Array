import { describe, expect, it } from "vitest";
import type { SituationId, WorkflowAction, WorkflowDraft } from "./schemas";
import { validateWorkflow } from "./workflowValidate";

function makeAction(overrides: Partial<WorkflowAction> = {}): WorkflowAction {
  return {
    id: "action_1",
    label: "Review",
    skillId: "review",
    prompt: "Review the diff",
    ...overrides,
  };
}

function makeDraft(
  bindings: Partial<Record<SituationId, WorkflowAction[]>>,
): WorkflowDraft {
  return {
    id: "wf_1",
    version: 1,
    bindings: bindings as WorkflowDraft["bindings"],
  };
}

describe("validateWorkflow", () => {
  it("accepts a fully populated valid draft", () => {
    const result = validateWorkflow(
      makeDraft({
        working: [makeAction()],
        in_review: [makeAction({ id: "action_2", label: "Nudge" })],
      }),
    );
    expect(result.canSave).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts an empty draft with no bindings", () => {
    const result = validateWorkflow(makeDraft({}));
    expect(result.canSave).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags duplicate action ids within the same situation", () => {
    const result = validateWorkflow(
      makeDraft({
        working: [makeAction({ id: "dupe" }), makeAction({ id: "dupe" })],
      }),
    );
    expect(result.canSave).toBe(false);
    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "duplicate_action_id",
        message: 'Duplicate action id "dupe" in working',
        situationId: "working",
        actionId: "dupe",
      },
    ]);
  });

  it("does not flag the same id reused across different situations", () => {
    const result = validateWorkflow(
      makeDraft({
        working: [makeAction({ id: "shared" })],
        in_review: [makeAction({ id: "shared" })],
      }),
    );
    expect(result.canSave).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a whitespace-only label", () => {
    const result = validateWorkflow(
      makeDraft({ working: [makeAction({ label: "   " })] }),
    );
    expect(result.canSave).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "action_empty_label",
      situationId: "working",
      actionId: "action_1",
    });
  });

  it("flags a whitespace-only prompt", () => {
    const result = validateWorkflow(
      makeDraft({ working: [makeAction({ prompt: "  \n " })] }),
    );
    expect(result.canSave).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "action_empty_prompt",
      situationId: "working",
      actionId: "action_1",
    });
  });

  it("reports both empty label and empty prompt for one action", () => {
    const result = validateWorkflow(
      makeDraft({ working: [makeAction({ label: " ", prompt: " " })] }),
    );
    const codes = result.diagnostics.map((d) => d.code).sort();
    expect(codes).toEqual(["action_empty_label", "action_empty_prompt"]);
    expect(result.canSave).toBe(false);
  });

  it("skips empty-field checks on a duplicate so it is reported once", () => {
    const result = validateWorkflow(
      makeDraft({
        working: [
          makeAction({ id: "dupe" }),
          makeAction({ id: "dupe", label: " ", prompt: " " }),
        ],
      }),
    );
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "duplicate_action_id",
    ]);
  });

  it("blocks saving only on error-severity diagnostics", () => {
    const result = validateWorkflow(
      makeDraft({ working: [makeAction({ label: "" })] }),
    );
    expect(result.canSave).toBe(false);
    expect(result.diagnostics.every((d) => d.severity === "error")).toBe(true);
  });
});
