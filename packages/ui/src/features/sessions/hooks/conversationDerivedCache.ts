import type { AcpMessage } from "@posthog/shared";
import type { BuildResult } from "@posthog/ui/features/sessions/components/buildConversationItems";
import { createIncrementalConversationBuilder } from "@posthog/ui/features/sessions/components/incrementalConversationItems";
import { createIncrementalThreadGrouper } from "@posthog/ui/features/sessions/components/new-thread/incrementalThreadGrouping";
import {
  type SessionState,
  useSessionStore,
} from "@posthog/ui/features/sessions/sessionStore";
import { LRUCache } from "lru-cache";

export interface ConversationBuildCache {
  impl: ReturnType<typeof createIncrementalConversationBuilder>;
  events: AcpMessage[] | null;
  pending: boolean | null;
  debug: boolean | undefined;
  result: BuildResult | null;
}

type ThreadGrouper = ReturnType<typeof createIncrementalThreadGrouper>;

export interface ConversationCacheKey {
  /**
   * Call-site namespace. Hooks that feed different inputs for the same task
   * (e.g. the chat thread vs its footer) must not share builder state, or
   * they'd invalidate each other on every render.
   */
  scope: string;
  taskId: string;
}

interface Entry<T> {
  /**
   * Entries are swept when their session's events are evicted, but only if
   * the session was ever seen in the store. Surfaces that render transcripts
   * without a live session (archive views) would otherwise be swept on every
   * store commit and rebuild from scratch each render.
   */
  hadSession: boolean;
  value: T;
}

/**
 * Re-opening a task unmounts and remounts its whole view tree, so
 * per-component caches die with it and every click re-parses the full
 * transcript (seconds of main-thread work for large sessions). These
 * module-level caches keep the incremental builder state alive across mounts.
 *
 * Entries are grouped per scope with the LRU cap applied inside each scope,
 * so surfaces that register several hooks per task (the chat thread and its
 * footer) don't shrink how many tasks stay cached.
 */
const MAX_CACHED_TASKS = 8;

type ScopeCache<T> = LRUCache<string, Entry<T>>;

const buildCaches = new Map<string, ScopeCache<ConversationBuildCache>>();
const threadGroupers = new Map<string, ScopeCache<ThreadGrouper>>();

export function getConversationBuildCache(
  key: ConversationCacheKey,
): ConversationBuildCache {
  return getEntry(buildCaches, key, () => ({
    impl: createIncrementalConversationBuilder(),
    events: null,
    pending: null,
    debug: undefined,
    result: null,
  }));
}

export function getPersistentThreadGrouper(
  key: ConversationCacheKey,
): ThreadGrouper {
  return getEntry(threadGroupers, key, createIncrementalThreadGrouper);
}

function getEntry<T extends {}>(
  map: Map<string, ScopeCache<T>>,
  key: ConversationCacheKey,
  create: () => T,
): T {
  watchStoreForEviction();
  let scopeCache = map.get(key.scope);
  if (!scopeCache) {
    scopeCache = new LRUCache({ max: MAX_CACHED_TASKS });
    map.set(key.scope, scopeCache);
  }
  let entry = scopeCache.get(key.taskId);
  if (!entry) {
    entry = { hadSession: false, value: create() };
    scopeCache.set(key.taskId, entry);
  }
  entry.hadSession ||= hasSession(useSessionStore.getState(), key.taskId);
  return entry.value;
}

function hasSession(state: SessionState, taskId: string): boolean {
  const taskRunId = state.taskIdIndex[taskId];
  return taskRunId !== undefined && state.sessions[taskRunId] !== undefined;
}

let watching = false;

function watchStoreForEviction(): void {
  if (watching) return;
  watching = true;
  // When the residency system evicts a backgrounded session's events (or the
  // session is torn down), drop its derived caches too: they reference the
  // evicted events, and keeping them would defeat the memory reclaim.
  useSessionStore.subscribe((state) => {
    sweepEvicted(buildCaches, state);
    sweepEvicted(threadGroupers, state);
  });
}

function sweepEvicted<T extends {}>(
  map: Map<string, ScopeCache<T>>,
  state: SessionState,
): void {
  for (const scopeCache of map.values()) {
    // Collect first: deleting while iterating an LRUCache is not guaranteed safe.
    const evicted: string[] = [];
    for (const [taskId, entry] of scopeCache.entries()) {
      if (!entry.hadSession) continue;
      const taskRunId = state.taskIdIndex[taskId];
      const session =
        taskRunId === undefined ? undefined : state.sessions[taskRunId];
      if (!session || session.events.length === 0) {
        evicted.push(taskId);
      }
    }
    for (const taskId of evicted) {
      scopeCache.delete(taskId);
    }
  }
}
