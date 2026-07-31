/**
 * Deterministic "PRs impacting this element" helpers: pure parsing over git
 * history (squash-merge subjects carry `(#123)`) and gh CLI output. The
 * service composes these; nothing here does I/O.
 */

export interface MergedPrRef {
  number: number;
  title: string;
  url: string;
  lastCommitDate: string;
}

export interface OpenPrRef {
  number: number;
  title: string;
  url: string;
  files: string[];
}

/** PR number from a merge/squash commit subject: a trailing `(#123)` (squash
 * convention) or a `Merge pull request #123` prefix. */
export function extractPrNumber(subject: string): number | null {
  const squash = subject.match(/\(#(\d+)\)\s*$/);
  if (squash) return Number(squash[1]);
  const merge = subject.match(/^Merge pull request #(\d+)/);
  if (merge) return Number(merge[1]);
  return null;
}

export function parseGithubRemote(
  remoteUrl: string,
): { owner: string; repo: string } | null {
  // `git remote get-url` output arrives with a trailing newline; without the
  // trim the repo group swallows ".git" and every PR URL 404s.
  const match = remoteUrl
    .trim()
    .match(
      /^(?:https:\/\/github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    );
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/** Collapse per-file commit history into unique merged PRs, newest first. */
export function aggregateMergedPrs(
  commits: Array<{ subject: string; date: string }>,
  remote: { owner: string; repo: string },
): MergedPrRef[] {
  const byNumber = new Map<number, MergedPrRef>();
  for (const commit of commits) {
    const number = extractPrNumber(commit.subject);
    if (number == null) continue;
    const title = commit.subject.replace(/\s*\(#\d+\)\s*$/, "");
    const existing = byNumber.get(number);
    if (existing && existing.lastCommitDate >= commit.date) continue;
    byNumber.set(number, {
      number,
      title,
      url: `https://github.com/${remote.owner}/${remote.repo}/pull/${number}`,
      lastCommitDate: commit.date,
    });
  }
  return [...byNumber.values()].sort((a, b) =>
    b.lastCommitDate.localeCompare(a.lastCommitDate),
  );
}

export function filterOpenPrsByFiles(
  prs: OpenPrRef[],
  files: string[],
): OpenPrRef[] {
  const wanted = new Set(files);
  return prs.filter((pr) => pr.files.some((file) => wanted.has(file)));
}
