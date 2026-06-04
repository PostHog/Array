import { CHAT_CONTENT_MAX_WIDTH } from "@features/sessions/constants";
import type { IconProps } from "@phosphor-icons/react";
import {
  BrainIcon,
  BugIcon,
  ChartLineIcon,
  ClipboardTextIcon,
  DatabaseIcon,
  FileTextIcon,
  FlagIcon,
  FlaskIcon,
  GaugeIcon,
  GlobeIcon,
  PlugIcon,
  SparkleIcon,
  TableIcon,
  VideoIcon,
} from "@phosphor-icons/react";
import {
  isNotification,
  POSTHOG_NOTIFICATIONS,
  type PostHogProductId,
} from "@posthog/agent";
import { Badge, Box, Flex, Text } from "@radix-ui/themes";
import {
  type AcpMessage,
  isJsonRpcNotification,
} from "@shared/types/session-events";
import { type ComponentType, useMemo } from "react";

/**
 * Icon per PostHog product. `Record<PostHogProductId, …>` keeps this exhaustive:
 * adding a product id in `@posthog/agent` forces an icon here at compile time.
 */
const PRODUCT_ICON: Record<PostHogProductId, ComponentType<IconProps>> = {
  product_analytics: ChartLineIcon,
  web_analytics: GlobeIcon,
  feature_flags: FlagIcon,
  experiments: FlaskIcon,
  error_tracking: BugIcon,
  session_replay: VideoIcon,
  surveys: ClipboardTextIcon,
  llm_analytics: BrainIcon,
  data_warehouse: DatabaseIcon,
  cdp: PlugIcon,
  logs: FileTextIcon,
  apm: GaugeIcon,
  sql: TableIcon,
  posthog: SparkleIcon,
};

interface ResourceProduct {
  id: PostHogProductId;
  label: string;
}

/**
 * Accumulate the de-duplicated, first-seen-ordered list of PostHog products
 * used across the whole session, from its `_posthog/resources_used`
 * notifications. Works for both live streaming and log replay, since both feed
 * the same `events` array. A product used on several turns appears once.
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

interface SessionResourcesBarProps {
  events: AcpMessage[];
}

/**
 * Persistent bar above the composer listing the PostHog products the agent has
 * touched (via the MCP `exec` tool) so far this session. Each product appears
 * once and is added the moment it's first used. Hidden until at least one
 * product has been used. Mirrors PlanStatusBar's placement and styling.
 */
export function SessionResourcesBar({ events }: SessionResourcesBarProps) {
  const products = useMemo(() => accumulateSessionResources(events), [events]);

  if (products.length === 0) return null;

  return (
    <Box>
      <Box className="mx-auto" style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}>
        <Flex align="center" gap="2" wrap="wrap" className="px-3 py-2">
          <Text color="gray" className="whitespace-nowrap text-[12px]">
            PostHog resources used
          </Text>
          {products.map((product) => {
            const Icon = PRODUCT_ICON[product.id] ?? SparkleIcon;
            return (
              <Badge key={product.id} size="1" color="gray" variant="soft">
                <Icon size={12} />
                {product.label}
              </Badge>
            );
          })}
        </Flex>
      </Box>
    </Box>
  );
}
