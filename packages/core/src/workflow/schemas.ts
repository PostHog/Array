import { z } from "zod";

// Order is load-bearing: the renderer iterates this list to render situations in
// a stable order. Classification itself runs server-side in PostHog.
export const SITUATIONS = [
  {
    id: "working",
    label: "Working",
    description: "Branch with changes, no PR yet",
  },
  {
    id: "in_review",
    label: "In review",
    description: "PR open, nothing pending from you",
  },
  {
    id: "ci_failing",
    label: "CI failing",
    description: "PR open, CI is red",
  },
  {
    id: "changes_requested",
    label: "Changes requested",
    description: "A reviewer requested changes",
  },
  {
    id: "comments_waiting",
    label: "Comments waiting",
    description: "Unresolved review threads not from you",
  },
  {
    id: "ready_to_merge",
    label: "Ready to merge",
    description: "PR open, CI green, approved, mergeable",
  },
  {
    id: "stale",
    label: "Stale",
    description: "No activity for a while",
  },
  {
    id: "done",
    label: "Done",
    description: "PR merged or closed",
  },
] as const;

export type SituationId = (typeof SITUATIONS)[number]["id"];
export const SITUATION_IDS = SITUATIONS.map((s) => s.id) as [
  SituationId,
  ...SituationId[],
];

export const situationId = z.enum(SITUATION_IDS);

export const workflowAction = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(120),
    skillId: z.string(),
    prompt: z.string().min(1).max(8_000),
    adapter: z.enum(["claude", "codex"]).optional(),
    model: z.string().min(1).optional(),
  })
  .strict();
export type WorkflowAction = z.infer<typeof workflowAction>;

export const workflowBindings = z.record(situationId, z.array(workflowAction));
export type WorkflowBindings = z.infer<typeof workflowBindings>;

export const workflowConfig = z
  .object({
    id: z.string().min(1),
    version: z.number().int().nonnegative(),
    updatedAt: z.string(),
    bindings: workflowBindings,
  })
  .strict();
export type WorkflowConfig = z.infer<typeof workflowConfig>;

export const workflowDraft = workflowConfig
  .omit({ updatedAt: true })
  .extend({ updatedAt: z.string().optional() });
export type WorkflowDraft = z.infer<typeof workflowDraft>;

export const validationDiagnostic = z
  .object({
    severity: z.enum(["error", "warning"]),
    code: z.enum([
      "duplicate_action_id",
      "action_empty_prompt",
      "action_empty_label",
    ]),
    message: z.string(),
    situationId: situationId.optional(),
    actionId: z.string().optional(),
  })
  .strict();
export type ValidationDiagnostic = z.infer<typeof validationDiagnostic>;

export const validationResult = z
  .object({
    diagnostics: z.array(validationDiagnostic),
    canSave: z.boolean(),
  })
  .strict();
export type ValidationResult = z.infer<typeof validationResult>;

export const saveInput = z
  .object({
    config: workflowDraft,
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export type SaveInput = z.infer<typeof saveInput>;

export const saveResult = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("saved"),
      config: workflowConfig,
      diagnostics: z.array(validationDiagnostic).optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("conflict"),
      config: workflowConfig.optional(),
      diagnostics: z.array(validationDiagnostic).optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("invalid"),
      config: workflowConfig.optional(),
      diagnostics: z.array(validationDiagnostic).optional(),
    })
    .strict(),
]);
export type SaveResult = z.infer<typeof saveResult>;
