import {
  isNotification,
  POSTHOG_NOTIFICATIONS,
} from "@posthog/agent/acp-extensions";
import type { PostHogProductId } from "@posthog/agent/posthog-products";
import { type AcpMessage, isJsonRpcNotification } from "@posthog/shared";

export interface ResourceProduct {
  id: PostHogProductId;
  label: string;
}

/**
 * Accumulate the de-duplicated, first-seen-ordered list of PostHog products
 * used across the whole session, from its `_posthog/resources_used`
 * notifications. Works for both live streaming and log replay, since both feed
 * the same `events` array. A product used on several turns appears once.
 *
 * Kept in its own module (no React / tRPC imports) so it stays a cheap,
 * dependency-free unit to test.
 */
export function accumulateSessionResources(
  events: AcpMessage[],
): ResourceProduct[] {
  const byId = new Map<PostHogProductId, ResourceProduct>();
  for (const event of events) {
    const msg = event.message;
    if (!isJsonRpcNotification(msg)) continue;
    if (!isNotification(msg.method, POSTHOG_NOTIFICATIONS.RESOURCES_USED)) {
      continue;
    }
    const products = (
      msg.params as { products?: ResourceProduct[] } | undefined
    )?.products;
    if (!products) continue;
    for (const product of products) {
      if (product && !byId.has(product.id)) byId.set(product.id, product);
    }
  }
  return [...byId.values()];
}
