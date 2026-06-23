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
    collectResourcesFromEvent(event, byId);
  }
  return [...byId.values()];
}

export function createSessionResourcesTracker() {
  let byId = new Map<PostHogProductId, ResourceProduct>();
  let products: ResourceProduct[] = [];
  let processedCount = 0;
  let firstEventRef: AcpMessage | null = null;
  let boundaryEventRef: AcpMessage | null = null;

  const reset = () => {
    byId = new Map<PostHogProductId, ResourceProduct>();
    products = [];
    processedCount = 0;
    firstEventRef = null;
    boundaryEventRef = null;
  };

  const update = (events: AcpMessage[]): ResourceProduct[] => {
    const canAppend =
      events.length >= processedCount &&
      (processedCount === 0 || events[0] === firstEventRef) &&
      (processedCount === 0 || events[processedCount - 1] === boundaryEventRef);

    if (!canAppend) {
      reset();
    }

    for (let i = processedCount; i < events.length; i++) {
      collectResourcesFromEvent(events[i], byId, products);
    }

    processedCount = events.length;
    firstEventRef = events[0] ?? null;
    boundaryEventRef = events[processedCount - 1] ?? null;

    return products;
  };

  return { update, reset };
}

function collectResourcesFromEvent(
  event: AcpMessage,
  byId: Map<PostHogProductId, ResourceProduct>,
  products?: ResourceProduct[],
) {
  const msg = event.message;
  if (!isJsonRpcNotification(msg)) return;
  if (!isNotification(msg.method, POSTHOG_NOTIFICATIONS.RESOURCES_USED)) {
    return;
  }
  const reportedProducts = (
    msg.params as { products?: ResourceProduct[] } | undefined
  )?.products;
  if (!reportedProducts) return;
  for (const product of reportedProducts) {
    if (!product || byId.has(product.id)) continue;
    byId.set(product.id, product);
    products?.push(product);
  }
}
