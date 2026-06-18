// PR attribution is deliberately split so it stays robust to SDK changes:
//   - `findPrUrl` pulls a PR URL out of *any* serialized stream event (terminal
//     output, content, or message). It assumes nothing about tool names, the
//     `_meta` shape, or how a Bash result is framed — the loosest possible
//     coupling, so SDK update-framing changes can't break detection.
//   - `wasCreatedRecently` decides whether that PR is *ours* using GitHub's own
//     `createdAt` (fetched by the caller) rather than parsing commands. We see a
//     PR's URL in the stream within moments of the agent creating it, so a PR
//     created in the last few minutes is ours; an older one was only viewed.
//     A fixed recency window (not "since the run started") keeps this correct
//     for arbitrarily long task runs — a PR the agent merely views mid-run is
//     still excluded because it wasn't created just now.

const PR_URL_REGEX = /https:\/\/github\.com\/[^/\s"]+\/[^/\s"]+\/pull\/\d+/;

// How recently a PR must have been created (relative to detection) to count as
// created by this run. Generous enough to absorb relay lag and clock skew, tight
// enough that a PR the agent merely viewed won't fall inside it.
export const PR_CREATION_RECENCY_MS = 15 * 60 * 1000;

/** First `https://github.com/<owner>/<repo>/pull/<n>` URL in `text`, or null. */
export function findPrUrl(text: string): string | null {
  return text.match(PR_URL_REGEX)?.[0] ?? null;
}

/**
 * True when a PR's `createdAt` (ISO string from `gh pr view --json createdAt`)
 * is within `maxAgeMs` of `nowMs` — i.e. created just now by this run rather
 * than an older PR the agent merely viewed. Fails closed (false) on
 * missing/invalid input so we never attribute on uncertainty.
 */
export function wasCreatedRecently(
  createdAtIso: string | null | undefined,
  nowMs: number,
  maxAgeMs: number = PR_CREATION_RECENCY_MS,
): boolean {
  if (!createdAtIso) return false;
  const createdAt = new Date(createdAtIso);
  if (Number.isNaN(createdAt.getTime())) return false;
  return createdAt.getTime() >= nowMs - maxAgeMs;
}
