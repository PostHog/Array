import { explorerHog } from "@posthog/ui/assets/hedgehogs";
import { AnimatedEllipsis } from "@posthog/ui/features/inbox/components/utils/AnimatedEllipsis";
import { SOURCE_PRODUCT_META } from "@posthog/ui/features/inbox/components/utils/source-product-icons";
import { Box, Button, Flex, Text, Tooltip } from "@radix-ui/themes";
import mailHog from "../../../assets/images/mail-hog.png";

// ── Full-width empty states ─────────────────────────────────────────────────

export function WarmingUpPane({
  onConfigureSources,
  enabledProducts,
}: {
  onConfigureSources: () => void;
  enabledProducts: string[];
}) {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      height="100%"
      px="5"
    >
      <Flex direction="column" align="center" className="max-w-[420px]">
        <img src={explorerHog} alt="" className="mb-[16px] w-[120px]" />

        <Text
          align="center"
          className="font-bold text-(--gray-12) text-lg leading-6.5"
        >
          Inbox is warming up
          <AnimatedEllipsis />
        </Text>

        <Text
          align="center"
          mt="3"
          className="text-(--gray-11) text-[13px] leading-[1.35]"
        >
          Reports will appear here as soon as signals come in.
        </Text>

        <Flex align="center" gap="3" className="mt-[16px]">
          {enabledProducts.map((sp) => {
            const meta = SOURCE_PRODUCT_META[sp];
            if (!meta) return null;
            const { Icon } = meta;
            return (
              <Tooltip key={sp} content={meta.label}>
                <span style={{ color: meta.color }}>
                  <Icon size={16} />
                </span>
              </Tooltip>
            );
          })}
          <Button
            size="2"
            variant="soft"
            color="gray"
            onClick={onConfigureSources}
          >
            Configure inbox
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}

export function SelectReportPane() {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      height="100%"
      px="5"
    >
      <Flex direction="column" align="center" className="max-w-[300px]">
        <img src={mailHog} alt="" className="mb-[12px] w-[100px] opacity-80" />
        <Text align="center" className="font-medium text-(--gray-10) text-sm">
          Select a report
        </Text>
        <Text
          align="center"
          mt="1"
          className="text-(--gray-9) text-[13px] leading-[1.35]"
        >
          Pick a report from the list to see details, signals, and evidence.
        </Text>
      </Flex>
    </Flex>
  );
}

// ── Skeleton rows for backdrop behind empty states ──────────────────────────

export function SkeletonBackdrop() {
  return (
    <Flex direction="column" className="select-none opacity-40">
      {Array.from({ length: 8 }).map((_, index) => (
        <Flex
          // biome-ignore lint/suspicious/noArrayIndexKey: static decorative placeholders
          key={index}
          direction="column"
          gap="2"
          px="3"
          py="3"
          className="border-gray-5 border-b"
        >
          <Box className="h-[12px] w-[44%] rounded bg-gray-4" />
          <Box className="h-[11px] w-[82%] rounded bg-gray-3" />
        </Flex>
      ))}
    </Flex>
  );
}
