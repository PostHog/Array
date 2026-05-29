import { Check, MagnifyingGlass, UsersThree } from "@phosphor-icons/react";
import {
  buildSuggestedReviewerFilterOptions,
  getSuggestedReviewerDisplayName,
} from "@posthog/core/inbox/suggestedReviewers";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useCurrentUser } from "@posthog/ui/features/auth/useCurrentUser";
import { useInboxAvailableSuggestedReviewers } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { useInboxSignalsFilterStore } from "@posthog/ui/features/inbox/inboxSignalsFilterStore";
import { Box, Flex, Popover, Separator, Spinner, Text } from "@radix-ui/themes";
import { useDeferredValue, useMemo, useState } from "react";

export function SuggestedReviewerFilterMenu() {
  const client = useOptionalAuthenticatedClient();
  const [open, setOpen] = useState(false);
  const [reviewerQuery, setReviewerQuery] = useState("");
  const deferredReviewerQuery = useDeferredValue(reviewerQuery);
  const { data: currentUser } = useCurrentUser({
    client,
    enabled: !!client,
  });
  const { data: availableReviewers, isFetching } =
    useInboxAvailableSuggestedReviewers({
      enabled: !!client,
      query: deferredReviewerQuery,
    });
  const suggestedReviewerFilter = useInboxSignalsFilterStore(
    (s) => s.suggestedReviewerFilter,
  );
  const toggleSuggestedReviewer = useInboxSignalsFilterStore(
    (s) => s.toggleSuggestedReviewer,
  );
  const setSuggestedReviewerFilter = useInboxSignalsFilterStore(
    (s) => s.setSuggestedReviewerFilter,
  );

  const visibleReviewerOptions = useMemo(() => {
    const reviewers = availableReviewers?.results ?? [];
    return buildSuggestedReviewerFilterOptions(reviewers, currentUser);
  }, [availableReviewers?.results, currentUser]);

  const selectedCount = suggestedReviewerFilter.length;
  const hasSelectedReviewers = selectedCount > 0;

  return (
    <Popover.Root
      modal
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setReviewerQuery("");
        }
      }}
    >
      <Popover.Trigger>
        <button
          type="button"
          aria-label="Filter by suggested reviewer"
          className={`flex h-6 min-w-6 items-center justify-center gap-1 rounded-sm px-1.5 transition-colors hover:bg-gray-3 hover:text-gray-12 ${
            selectedCount > 0 ? "bg-gray-3 text-gray-12" : "text-gray-10"
          }`}
        >
          <UsersThree size={14} />
          {selectedCount > 0 ? (
            <span className="text-[11px] text-gray-12 leading-none">
              {selectedCount}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Content
        align="end"
        side="bottom"
        sideOffset={6}
        className="min-w-[280px] max-w-[320px] p-[8px]"
      >
        <Flex direction="column" gap="2">
          <Flex align="center" justify="between" gap="2">
            <Text className="pl-[1px] font-medium text-[13px] text-gray-10">
              Suggested reviewer
            </Text>
            {hasSelectedReviewers ? (
              <button
                type="button"
                onClick={() => setSuggestedReviewerFilter([])}
                className="rounded-sm px-1 py-0.5 text-[11px] text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
              >
                Clear
              </button>
            ) : null}
          </Flex>

          <Flex
            align="center"
            gap="2"
            px="2"
            py="1"
            className="rounded-(--radius-2) border border-(--gray-6) bg-(--color-background)"
          >
            <MagnifyingGlass size={12} className="shrink-0 text-gray-10" />
            <input
              type="text"
              placeholder="Filter users..."
              value={reviewerQuery}
              onChange={(e) => setReviewerQuery(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-gray-12 outline-none placeholder:text-gray-9"
            />
          </Flex>

          <Box className="max-h-[280px] overflow-y-auto">
            {isFetching && visibleReviewerOptions.length === 0 ? (
              <Flex align="center" justify="center" py="3">
                <Spinner size="1" />
              </Flex>
            ) : visibleReviewerOptions.length === 0 ? (
              <Text color="gray" className="px-1 py-2 text-[12px]">
                No users found.
              </Text>
            ) : (
              <Flex direction="column">
                {visibleReviewerOptions.map((reviewer, index) => {
                  const isSelected = suggestedReviewerFilter.includes(
                    reviewer.uuid,
                  );
                  const displayName = getSuggestedReviewerDisplayName(reviewer);

                  return (
                    <Box key={reviewer.uuid}>
                      <button
                        type="button"
                        className="flex w-full items-start justify-between rounded-sm px-1 py-1 text-left text-[13px] text-gray-12 transition-colors hover:bg-gray-3 focus-visible:bg-gray-3 focus-visible:outline-none"
                        onClick={() => toggleSuggestedReviewer(reviewer.uuid)}
                      >
                        <Flex align="center" gap="2" className="min-w-0">
                          {reviewer.github_login ? (
                            <img
                              src={`https://github.com/${reviewer.github_login}.png?size=32`}
                              alt=""
                              className="github-avatar h-[20px] w-[20px] shrink-0 rounded-full"
                              onLoad={(e) =>
                                e.currentTarget.classList.add("loaded")
                              }
                            />
                          ) : null}
                          <Flex direction="column" gap="0" className="min-w-0">
                            <Text className="truncate text-[12px]">
                              {displayName}
                            </Text>
                            {reviewer.email ? (
                              <Text
                                color="gray"
                                className="truncate text-[11px]"
                              >
                                {reviewer.email}
                              </Text>
                            ) : null}
                          </Flex>
                        </Flex>
                        <span
                          className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-12"
                          aria-hidden
                        >
                          {isSelected ? (
                            <Check size={12} weight="bold" />
                          ) : null}
                        </span>
                      </button>

                      {reviewer.showSeparatorBelow &&
                      index < visibleReviewerOptions.length - 1 ? (
                        <Separator size="4" my="1" />
                      ) : null}
                    </Box>
                  );
                })}
              </Flex>
            )}
          </Box>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
