/**
 * Stand-in for posthog's `lib/utils/retryImport`. This host bundles the shim
 * code editor locally, so chunk-load retries are unnecessary — this is a plain
 * `React.lazy` with the upstream call signature.
 */
import { type ComponentType, type LazyExoticComponent, lazy } from "react";

export function lazyWithRetry<
  // biome-ignore lint/suspicious/noExplicitAny: matches React's own LazyExoticComponent constraint
  T extends ComponentType<any>,
>(factory: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  return lazy(factory);
}
