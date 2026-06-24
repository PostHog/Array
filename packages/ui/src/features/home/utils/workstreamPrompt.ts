import type { HomeWorkstream } from "@posthog/core/home/schemas";
import type { WorkflowAction } from "@posthog/core/workflow/schemas";

type SkillAction = Pick<WorkflowAction, "skillId" | "prompt">;

// The agent runs the bound skill when the prompt starts with `/<skill-id>`, so
// embed it directly; the descriptive prompt follows as the instruction. With no
// skill bound, send the prompt on its own.
export function buildSkillPrompt(action: SkillAction): string {
  const body = action.prompt.trim();
  const skillId = action.skillId.trim();
  if (!skillId) return body;
  const command = `/${skillId}`;
  return body ? `${command}\n\n${body}` : command;
}

// Pins a one-click run to the PR/branch its workstream represents so a
// background quick action knows exactly what it's acting on, instead of landing
// on the host repo's default branch and asking the user "which PR?". Only the
// fields the snapshot actually carries are emitted, so a branch-only workstream
// still gets a useful block and a bare one contributes nothing.
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
  return `\n\nContext for this task (already known — don't ask the user for it):\n${lines.join(
    "\n",
  )}`;
}

// Full prompt for a one-click quick action: the skill command plus the action's
// instruction, anchored to the workstream's PR/branch so a background run has
// the signal it needs to act without prompting the user.
export function buildQuickActionPrompt(
  action: SkillAction,
  workstream: HomeWorkstream,
): string {
  return `${buildSkillPrompt(action)}${buildWorkstreamContext(workstream)}`;
}
