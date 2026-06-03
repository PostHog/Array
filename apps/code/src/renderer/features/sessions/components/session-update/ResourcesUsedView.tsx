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
import type { PostHogProductId } from "@posthog/agent";
import { Badge, Box, Flex, Text } from "@radix-ui/themes";
import type { ComponentType } from "react";

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

interface ResourcesUsedViewProps {
  products: { id: PostHogProductId; label: string }[];
}

/**
 * A subtle chip row rendered under a completed turn, listing the PostHog
 * products the agent touched (via the MCP `exec` tool) while answering.
 */
export function ResourcesUsedView({ products }: ResourcesUsedViewProps) {
  if (products.length === 0) return null;

  return (
    <Box className="mt-0.5 mb-1 pl-3">
      <Flex align="center" gap="2" wrap="wrap">
        <Text className="text-[12px] text-gray-9">PostHog resources used</Text>
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
  );
}
