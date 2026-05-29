import type { WorkflowConfig } from "@shared/types/workflow";

// Seed config: applied on first run and on "Reset to default".
export function buildDefaultWorkflow(): WorkflowConfig {
  return {
    id: "default",
    version: 1,
    updatedAt: new Date(0).toISOString(),
    bindings: {
      working: [
        {
          id: "create_pr",
          label: "Create PR",
          skillId: "create-pr",
          prompt:
            "Open a PR for the current branch. Use the task history to write a concise description.",
        },
      ],
      in_review: [],
      ci_failing: [
        {
          id: "fix_ci",
          label: "Fix CI",
          skillId: "fix-ci",
          prompt:
            "CI is failing on this PR. Investigate the failing checks and push a fix.",
        },
      ],
      changes_requested: [
        {
          id: "address_comments",
          label: "Address review",
          skillId: "address-comments",
          prompt:
            "Address the change requests on this PR — read the latest review and respond with code.",
        },
      ],
      comments_waiting: [
        {
          id: "address_threads",
          label: "Address comments",
          skillId: "address-comments",
          prompt: "Address the unresolved review comments on this PR.",
        },
      ],
      ready_to_merge: [
        {
          id: "final_check",
          label: "Final check",
          skillId: "code-review",
          prompt:
            "Do a last-pass review of this PR. Call out anything risky before I merge.",
        },
      ],
      stale: [],
      done: [],
    },
  };
}
