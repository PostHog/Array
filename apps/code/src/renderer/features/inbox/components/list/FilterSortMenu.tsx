import { PgAnalyzeIcon } from "@features/inbox/components/utils/PgAnalyzeIcon";
import {
  type SourceProduct,
  useInboxSignalsFilterStore,
} from "@features/inbox/stores/inboxSignalsFilterStore";
import {
  inboxStatusAccentCss,
  inboxStatusLabel,
} from "@features/inbox/utils/inboxSort";
import {
  BrainIcon,
  BugIcon,
  CalendarPlus,
  Check,
  Clock,
  FunnelSimple as FunnelSimpleIcon,
  GithubLogoIcon,
  KanbanIcon,
  LifebuoyIcon,
  ListNumbers,
  TicketIcon,
  TrendUp,
  VideoIcon,
} from "@phosphor-icons/react";
import { Box, Flex, Popover, Text } from "@radix-ui/themes";
import type {
  SignalReportOrderingField,
  SignalReportStatus,
} from "@shared/types";
import type React from "react";
import type { KeyboardEvent } from "react";

type SortOption = {
  label: string;
  field: Extract<
    SignalReportOrderingField,
    "priority" | "created_at" | "total_weight"
  >;
  direction: "asc" | "desc";
  icon: React.ReactNode;
};

const SORT_OPTIONS: SortOption[] = [
  {
    label: "Priority",
    field: "priority",
    direction: "asc",
    icon: <ListNumbers size={14} />,
  },
  {
    label: "Strongest signal",
    field: "total_weight",
    direction: "desc",
    icon: <TrendUp size={14} />,
  },
  {
    label: "Newest first",
    field: "created_at",
    direction: "desc",
    icon: <CalendarPlus size={14} />,
  },
  {
    label: "Oldest first",
    field: "created_at",
    direction: "asc",
    icon: <Clock size={14} />,
  },
];

const FILTERABLE_STATUSES: SignalReportStatus[] = [
  "ready",
  "pending_input",
  "in_progress",
  "failed",
  "candidate",
  "potential",
];

const SOURCE_PRODUCT_OPTIONS: {
  value: SourceProduct;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "session_replay",
    label: "Session replay",
    icon: <VideoIcon size={14} />,
  },
  {
    value: "error_tracking",
    label: "Error tracking",
    icon: <BugIcon size={14} />,
  },
  {
    value: "llm_analytics",
    label: "LLM analytics",
    icon: <BrainIcon size={14} />,
  },
  { value: "github", label: "GitHub", icon: <GithubLogoIcon size={14} /> },
  { value: "linear", label: "Linear", icon: <KanbanIcon size={14} /> },
  { value: "zendesk", label: "Zendesk", icon: <TicketIcon size={14} /> },
  {
    value: "conversations",
    label: "Conversations",
    icon: <LifebuoyIcon size={14} />,
  },
  { value: "pganalyze", label: "pganalyze", icon: <PgAnalyzeIcon size={14} /> },
];

const ITEM_CLASS_NAME =
  "flex w-full items-center justify-between rounded-sm px-1 py-1 text-left text-[13px] text-gray-12 transition-colors hover:bg-gray-3 focus-visible:bg-gray-3 focus-visible:outline-none";

export function FilterSortMenu() {
  const sortField = useInboxSignalsFilterStore((s) => s.sortField);
  const sortDirection = useInboxSignalsFilterStore((s) => s.sortDirection);
  const setSort = useInboxSignalsFilterStore((s) => s.setSort);
  const statusFilter = useInboxSignalsFilterStore((s) => s.statusFilter);
  const toggleStatus = useInboxSignalsFilterStore((s) => s.toggleStatus);
  const sourceProductFilter = useInboxSignalsFilterStore(
    (s) => s.sourceProductFilter,
  );
  const toggleSourceProduct = useInboxSignalsFilterStore(
    (s) => s.toggleSourceProduct,
  );

  const handleContentKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;

    e.preventDefault();
    e.stopPropagation();

    const container = e.currentTarget;
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    );

    if (buttons.length === 0) {
      return;
    }

    const currentIndex = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const nextIndex =
      e.key === "ArrowDown"
        ? (currentIndex + 1) % buttons.length
        : (currentIndex - 1 + buttons.length) % buttons.length;

    buttons[nextIndex]?.focus();
  };

  return (
    <Popover.Root modal>
      <Popover.Trigger>
        <button
          type="button"
          aria-label="Filter and sort signals"
          className="flex h-6 w-6 items-center justify-center rounded-sm text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
        >
          <FunnelSimpleIcon size={14} />
        </button>
      </Popover.Trigger>

      <Popover.Content
        align="end"
        side="bottom"
        sideOffset={6}
        onKeyDown={handleContentKeyDown}
        className="min-w-[220px] p-[8px]"
      >
        <Flex direction="column" gap="3">
          <Box>
            <Text className="pl-[1px] font-medium text-[13px] text-gray-10">
              Sort by
            </Text>
            <Box mt="1">
              {SORT_OPTIONS.map((option) => {
                const isActive =
                  sortField === option.field &&
                  sortDirection === option.direction;

                return (
                  <button
                    key={`${option.field}-${option.direction}`}
                    type="button"
                    className={ITEM_CLASS_NAME}
                    onClick={() => setSort(option.field, option.direction)}
                  >
                    <span className="flex items-center gap-1 text-gray-12">
                      {option.icon}
                      <span>{option.label}</span>
                    </span>
                    {isActive && <Check size={12} className="text-gray-12" />}
                  </button>
                );
              })}
            </Box>
          </Box>

          <Box>
            <Text className="pl-[1px] font-medium text-[13px] text-gray-10">
              Status
            </Text>
            <Box mt="1">
              {FILTERABLE_STATUSES.map((status) => {
                const isActive = statusFilter.includes(status);
                const accent = inboxStatusAccentCss(status);

                return (
                  <button
                    key={status}
                    type="button"
                    className={ITEM_CLASS_NAME}
                    onClick={() => toggleStatus(status)}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: accent }}
                      />
                      <span className="text-gray-12">
                        {inboxStatusLabel(status)}
                      </span>
                    </span>
                    {isActive && <Check size={12} className="text-gray-12" />}
                  </button>
                );
              })}
            </Box>
          </Box>

          <Box>
            <Text className="pl-[1px] font-medium text-[13px] text-gray-10">
              Source
            </Text>
            <Box mt="1">
              {SOURCE_PRODUCT_OPTIONS.map((option) => {
                const isActive = sourceProductFilter.includes(option.value);

                return (
                  <button
                    key={option.value}
                    type="button"
                    className={ITEM_CLASS_NAME}
                    onClick={() => toggleSourceProduct(option.value)}
                  >
                    <span className="flex items-center gap-1 text-gray-12">
                      {option.icon}
                      <span>{option.label}</span>
                    </span>
                    {isActive && <Check size={12} className="text-gray-12" />}
                  </button>
                );
              })}
            </Box>
          </Box>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
