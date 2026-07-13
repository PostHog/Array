import type { WorkflowAction } from "../workflow/schemas";
import type { HomeWorkstream } from "./schemas";

type SkillAction = Pick<WorkflowAction, "skillId" | "prompt">;

// The agent runs the bound skill when the prompt opens with `/<skill-id>`.
export function buildSkillPrompt(action: SkillAction): string {
  const body = action.prompt.trim();
  const skillId = action.skillId.trim();
  if (!skillId) return body;
  const command = `/${skillId}`;
  return body ? `${command}\n\n${body}` : command;
}

// Anchors a background run to the PR/branch it's meant to act on so it doesn't
// have to ask the user which one.
export function buildWorkstreamContext(workstream: HomeWorkstream): string {
  const lines: string[] = [];
  if (workstream.repoFullPath) {
    lines.push(`- Repository: ${workstream.repoFullPath}`);
  }
  if (workstream.branch) {
    lines.push(`- Branch: ${workstream.branch}`);
  }
  const pr = workstream.pr;
  if (pr) {
    lines.push(`- Pull request #${pr.number}: ${pr.title}`);
    lines.push(`  ${pr.url}`);
    lines.push(`  CI: ${pr.ciStatus}`);
    if (pr.reviewDecision) {
      lines.push(`  Review: ${pr.reviewDecision}`);
    }
    if (pr.unresolvedThreads > 0) {
      lines.push(`  Unresolved review threads: ${pr.unresolvedThreads}`);
    }
  } else if (workstream.prUrl) {
    lines.push(`- Pull request: ${workstream.prUrl}`);
  }
  if (lines.length === 0) return "";
  const header =
    "Context for this task (already known — don't ask the user for it):";
  return `\n\n${header}\n${lines.join("\n")}`;
}

export function buildQuickActionPrompt(
  action: SkillAction,
  workstream: HomeWorkstream,
): string {
  return `${buildSkillPrompt(action)}${buildWorkstreamContext(workstream)}`;
}
