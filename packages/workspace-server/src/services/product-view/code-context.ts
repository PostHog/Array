import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getGitOperationManager } from "@posthog/git/operation-manager";
import { getRemoteUrl, listFilesContainingText } from "@posthog/git/queries";
import { injectable } from "inversify";
import {
  aggregateMergedPrs,
  filterOpenPrsByFiles,
  type MergedPrRef,
  type OpenPrRef,
  parseGithubRemote,
} from "./prImpact";

const execFileAsync = promisify(execFile);

export interface ElementCodeContext {
  /** Repo-relative files that reference the element's stable keys. */
  files: string[];
  mergedPrs: MergedPrRef[];
  openPrs: Array<Omit<OpenPrRef, "files">>;
  /** False when the gh CLI wasn't available/authenticated — merged history
   * (pure git) still works then. */
  openPrsAvailable: boolean;
}

const MAX_FILES = 12;
const MAX_MERGED_PRS = 8;
const GH_TIMEOUT_MS = 10_000;

export interface IProductCodeContextService {
  getElementCodeContext(input: {
    repoPath: string;
    needles: string[];
  }): Promise<ElementCodeContext>;
}

/**
 * Deterministic element → code → PRs mapping for the details panel: grep the
 * local checkout for the element's stable keys (data-attr value, event name),
 * then surface recently-merged PRs (squash subjects in `git log -- <files>`)
 * and open PRs whose diff touches those files (gh CLI, degrades gracefully).
 */
@injectable()
export class ProductCodeContextService implements IProductCodeContextService {
  async getElementCodeContext(input: {
    repoPath: string;
    needles: string[];
  }): Promise<ElementCodeContext> {
    const files = await this.findFiles(input.repoPath, input.needles);
    if (files.length === 0) {
      return { files, mergedPrs: [], openPrs: [], openPrsAvailable: true };
    }

    const remoteUrl = await getRemoteUrl(input.repoPath).catch(() => null);
    const remote = remoteUrl ? parseGithubRemote(remoteUrl) : null;

    const [mergedPrs, open] = await Promise.all([
      remote
        ? this.mergedPrsTouching(input.repoPath, files, remote)
        : Promise.resolve([]),
      remote
        ? this.openPrsTouching(input.repoPath, remote, files)
        : Promise.resolve({ prs: [], available: false }),
    ]);

    return {
      files,
      mergedPrs: mergedPrs.slice(0, MAX_MERGED_PRS),
      openPrs: open.prs.map(({ files: _files, ...pr }) => pr),
      openPrsAvailable: open.available,
    };
  }

  private async findFiles(
    repoPath: string,
    needles: string[],
  ): Promise<string[]> {
    const files = new Set<string>();
    for (const needle of needles.slice(0, 3)) {
      if (!needle || needle.length < 3) continue;
      const hits = await listFilesContainingText(repoPath, needle).catch(
        () => [] as string[],
      );
      for (const hit of hits) {
        files.add(hit);
        if (files.size >= MAX_FILES) return [...files];
      }
    }
    return [...files];
  }

  private async mergedPrsTouching(
    repoPath: string,
    files: string[],
    remote: { owner: string; repo: string },
  ): Promise<MergedPrRef[]> {
    const manager = getGitOperationManager();
    const output = await manager
      .executeRead(repoPath, async (git) =>
        git.raw([
          "log",
          "--since=90.days",
          "--date=short",
          "--pretty=format:%ad\t%s",
          "--",
          ...files,
        ]),
      )
      .catch(() => "");
    const commits = output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [date, ...rest] = line.split("\t");
        return { date, subject: rest.join("\t") };
      });
    return aggregateMergedPrs(commits, remote);
  }

  private async openPrsTouching(
    repoPath: string,
    remote: { owner: string; repo: string },
    files: string[],
  ): Promise<{ prs: OpenPrRef[]; available: boolean }> {
    try {
      const { stdout } = await execFileAsync(
        "gh",
        [
          "pr",
          "list",
          "--repo",
          `${remote.owner}/${remote.repo}`,
          "--state",
          "open",
          "--limit",
          "30",
          "--json",
          "number,title,url,files",
        ],
        { cwd: repoPath, timeout: GH_TIMEOUT_MS },
      );
      const parsed = JSON.parse(stdout) as Array<{
        number?: number;
        title?: string;
        url?: string;
        files?: Array<{ path?: string }>;
      }>;
      const prs: OpenPrRef[] = parsed
        .filter(
          (pr) =>
            typeof pr.number === "number" &&
            typeof pr.url === "string" &&
            Array.isArray(pr.files),
        )
        .map((pr) => ({
          number: pr.number as number,
          title: pr.title ?? `PR #${pr.number}`,
          url: pr.url as string,
          files: (pr.files ?? [])
            .map((file) => file.path)
            .filter((path): path is string => typeof path === "string"),
        }));
      return { prs: filterOpenPrsByFiles(prs, files), available: true };
    } catch {
      return { prs: [], available: false };
    }
  }
}
