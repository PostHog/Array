import { execFileSync, execSync } from "node:child_process";
import { platform } from "node:os";

const SIGKILL_GRACE_MS = 5_000;

interface ProcessEntry {
  pid: number;
  ppid: number;
  pgid: number;
}

export function findProcessTree(
  rootPid: number,
  processTable: readonly ProcessEntry[],
): ProcessEntry[] {
  const children = new Map<number, ProcessEntry[]>();
  for (const entry of processTable) {
    const siblings = children.get(entry.ppid) ?? [];
    siblings.push(entry);
    children.set(entry.ppid, siblings);
  }

  const tree: ProcessEntry[] = [];
  const visit = (pid: number): void => {
    for (const child of children.get(pid) ?? []) {
      visit(child.pid);
      tree.push(child);
    }
  };
  visit(rootPid);

  const root = processTable.find((entry) => entry.pid === rootPid);
  if (root) tree.push(root);
  return tree;
}

function snapshotUnixProcessTree(rootPid: number): ProcessEntry[] {
  try {
    const output = execFileSync("ps", ["-axo", "pid=,ppid=,pgid="], {
      encoding: "utf8",
    });
    const entries = output
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter(
        (parts) =>
          parts.length === 3 && parts.every((part) => Number.isInteger(part)),
      )
      .map(([pid, ppid, pgid]) => ({ pid, ppid, pgid }));
    return findProcessTree(rootPid, entries);
  } catch {
    return [];
  }
}

function signalTargets(
  targets: readonly number[],
  signal: NodeJS.Signals,
): void {
  for (const target of targets) {
    try {
      process.kill(target, signal);
    } catch {}
  }
}

/**
 * Kill a process and all its descendants, including children that created
 * their own process groups.
 * On Windows, we use taskkill with /T flag to kill the process tree.
 */
export function killProcessTree(pid: number): void {
  try {
    if (platform() === "win32") {
      // Windows: use taskkill with /T to kill process tree
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      const tree = snapshotUnixProcessTree(pid);
      const ownProcess = snapshotUnixProcessTree(process.pid).at(-1);
      const groups = new Set(
        tree
          .map((entry) => entry.pgid)
          .filter((pgid) => pgid > 0 && pgid !== ownProcess?.pgid),
      );
      const targets = [
        ...Array.from(groups, (pgid) => -pgid),
        ...tree.map((entry) => entry.pid),
      ];
      if (targets.length === 0) targets.push(-pid, pid);

      signalTargets(targets, "SIGTERM");

      // Force kill after a grace period — unref so the timer doesn't delay app exit.
      setTimeout(() => {
        signalTargets(targets, "SIGKILL");
      }, SIGKILL_GRACE_MS).unref();
    }
  } catch {}
}

/**
 * Check if a process is alive using signal 0.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
