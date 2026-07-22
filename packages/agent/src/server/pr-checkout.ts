import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type CommandResult = { stdout: string };
type RunCommand = (
  executable: string,
  args: string[],
  cwd: string,
) => Promise<CommandResult>;

export type ExistingPrCheckoutResult =
  | { status: "already_active"; branch: string }
  | { status: "checked_out"; branch: string }
  | { status: "failed"; error: string };

async function defaultRunCommand(
  executable: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  const { stdout } = await execFileAsync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout };
}

export async function checkoutExistingPullRequest({
  repositoryPath,
  prUrl,
  runCommand = defaultRunCommand,
}: {
  repositoryPath: string;
  prUrl: string;
  runCommand?: RunCommand;
}): Promise<ExistingPrCheckoutResult> {
  try {
    const [currentBranchResult, prBranchResult] = await Promise.all([
      runCommand("git", ["branch", "--show-current"], repositoryPath),
      runCommand(
        "gh",
        ["pr", "view", prUrl, "--json", "headRefName", "--jq", ".headRefName"],
        repositoryPath,
      ),
    ]);
    const currentBranch = currentBranchResult.stdout.trim();
    const prBranch = prBranchResult.stdout.trim();

    if (!prBranch) {
      return { status: "failed", error: "Pull request head branch is empty" };
    }
    if (currentBranch === prBranch) {
      return { status: "already_active", branch: prBranch };
    }

    await runCommand("gh", ["pr", "checkout", prUrl], repositoryPath);
    return { status: "checked_out", branch: prBranch };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
