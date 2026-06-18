import { useMemo } from "react";
import { useAgentEnvKeys } from "./useAgentEnvKeys";
import { useAgentRevision } from "./useAgentRevision";

const EMPTY: string[] = [];

/**
 * Names of secrets the given revision declares in its spec but the agent
 * doesn't have set yet. Draft previews inherit live env-keys read-only by
 * default; for any name in this list the runner will fail at use-site unless
 * the author provides a per-preview override via the mint endpoint.
 *
 * Returns the empty list when no revision is targeted (live chat doesn't
 * surface this — drafts are the only place where unset secrets are an
 * authoring blocker).
 */
export function useAgentMissingSecrets(
  idOrSlug: string,
  revisionId: string | null,
): string[] {
  const { data: revision } = useAgentRevision(idOrSlug, revisionId);
  const { data: envKeys } = useAgentEnvKeys(idOrSlug);
  return useMemo(() => {
    if (!revisionId) return EMPTY;
    const declared = revision?.spec?.secrets ?? [];
    if (declared.length === 0) return EMPTY;
    const set = new Set(envKeys ?? []);
    const missing = declared.filter((name) => !set.has(name));
    return missing.length === declared.length && envKeys == null
      ? // env-keys query hasn't loaded yet; avoid flashing the card with the
        // full list before we know what's actually set.
        EMPTY
      : missing;
  }, [revisionId, revision, envKeys]);
}
