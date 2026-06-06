import { Badge } from "@components/ui/Badge";
import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useCurrentUser } from "@features/auth/hooks/authQueries";
import {
  useInboxAvailableSuggestedReviewers,
  useUpdateSuggestedReviewers,
} from "@features/inbox/hooks/useInboxReports";
import {
  buildSuggestedReviewerFilterOptions,
  getSuggestedReviewerDisplayName,
} from "@features/inbox/utils/suggestedReviewerFilters";
import {
  ArrowSquareOutIcon,
  Check,
  EyeIcon,
  InfoIcon,
  MagnifyingGlass,
  Plus,
  XIcon,
} from "@phosphor-icons/react";
import { Box, Flex, Popover, Spinner, Text, Tooltip } from "@radix-ui/themes";
import type {
  AvailableSuggestedReviewer,
  SuggestedReviewer,
  SuggestedReviewersArtefact,
  SuggestedReviewerWriteEntry,
} from "@shared/types";
import { useDeferredValue, useMemo, useState } from "react";

type ReviewerAction =
  | "click_suggested_reviewer"
  | "add_suggested_reviewer"
  | "remove_suggested_reviewer";

/** Identity of the reviewer the action targeted, attached to the analytics event. */
interface ReviewerActionExtra {
  suggested_reviewer_login?: string;
  suggested_reviewer_uuid?: string;
}

interface SuggestedReviewersEditorProps {
  reportId: string;
  artefact: SuggestedReviewersArtefact;
  meUuid: string | undefined;
  fireAction: (action: ReviewerAction, extra?: ReviewerActionExtra) => void;
}

function isRowMe(
  reviewer: SuggestedReviewer,
  meUuid: string | undefined,
): boolean {
  return !!reviewer.user?.uuid && !!meUuid && meUuid === reviewer.user.uuid;
}

/** A reviewer in the artefact matches an org member by user uuid or (case-insensitive) login. */
function reviewerMatchesAvailable(
  reviewer: SuggestedReviewer,
  available: AvailableSuggestedReviewer,
): boolean {
  if (reviewer.user?.uuid && reviewer.user.uuid === available.uuid) {
    return true;
  }
  return (
    !!reviewer.github_login &&
    !!available.github_login &&
    reviewer.github_login.toLowerCase() === available.github_login.toLowerCase()
  );
}

/**
 * Build the write-shape payload from a read-shape list. Kept reviewers are sent by
 * `github_login` (the server preserves their commits/name); an entry that only has a
 * resolved user (e.g. one optimistically added before the refetch fills in its login)
 * falls back to `user_uuid`. Entries with neither are dropped.
 */
function toWriteContent(
  reviewers: SuggestedReviewer[],
): SuggestedReviewerWriteEntry[] {
  return reviewers
    .map((reviewer): SuggestedReviewerWriteEntry | null => {
      if (reviewer.github_login) {
        return { github_login: reviewer.github_login };
      }
      if (reviewer.user?.uuid) {
        return { user_uuid: reviewer.user.uuid };
      }
      return null;
    })
    .filter((entry): entry is SuggestedReviewerWriteEntry => entry !== null);
}

export function SuggestedReviewersEditor({
  reportId,
  artefact,
  meUuid,
  fireAction,
}: SuggestedReviewersEditorProps) {
  const client = useOptionalAuthenticatedClient();
  const [addOpen, setAddOpen] = useState(false);
  const [reviewerQuery, setReviewerQuery] = useState("");
  const deferredReviewerQuery = useDeferredValue(reviewerQuery);

  const { mutate: updateReviewers, isPending } =
    useUpdateSuggestedReviewers(reportId);

  // Reviewers in their original (agent-ranked) order — used to build write payloads.
  const reviewers = artefact.content;

  // Display order: pin the current user first, otherwise preserve agent ranking.
  const displayReviewers = useMemo(() => {
    if (!meUuid) return reviewers;
    const meIndex = reviewers.findIndex((r) => r.user?.uuid === meUuid);
    if (meIndex <= 0) return reviewers;
    return [reviewers[meIndex], ...reviewers.filter((_, i) => i !== meIndex)];
  }, [reviewers, meUuid]);

  const { data: currentUser } = useCurrentUser({ client, enabled: !!client });
  // Fetch the full base list (no `query`) so it's served from the cached
  // `inboxAvailableSuggestedReviewersStore` and we filter locally — avoids a
  // server round-trip on every keystroke.
  const { data: availableReviewers, isFetching } =
    useInboxAvailableSuggestedReviewers({
      enabled: !!client && addOpen,
    });

  // Org members that can be added. The `available_reviewers` endpoint only returns
  // members with a linked GitHub identity, so every option is addable via its uuid —
  // note the endpoint does not include `github_login` in its payload.
  const addableOptions = useMemo(() => {
    const options = buildSuggestedReviewerFilterOptions(
      availableReviewers?.results ?? [],
      currentUser,
    );
    const q = deferredReviewerQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (option) =>
        option.name.toLowerCase().includes(q) ||
        option.email.toLowerCase().includes(q) ||
        option.github_login.toLowerCase().includes(q),
    );
  }, [availableReviewers?.results, currentUser, deferredReviewerQuery]);

  const removeReviewer = (target: SuggestedReviewer) => {
    const next = reviewers.filter((r) => r !== target);
    fireAction("remove_suggested_reviewer", {
      suggested_reviewer_login: target.github_login || undefined,
      suggested_reviewer_uuid: target.user?.uuid,
    });
    updateReviewers({
      artefactId: artefact.id,
      content: toWriteContent(next),
      optimisticReviewers: next,
    });
  };

  const toggleReviewer = (option: AvailableSuggestedReviewer) => {
    const existing = reviewers.find((r) => reviewerMatchesAvailable(r, option));
    if (existing) {
      removeReviewer(existing);
      return;
    }

    const optimisticEntry: SuggestedReviewer = {
      github_login: option.github_login,
      github_name: option.name || null,
      relevant_commits: [],
      user: {
        id: 0,
        uuid: option.uuid,
        email: option.email,
        first_name: option.name,
        last_name: "",
      },
    };
    const next = [...reviewers, optimisticEntry];
    fireAction("add_suggested_reviewer", {
      suggested_reviewer_login: option.github_login || undefined,
      suggested_reviewer_uuid: option.uuid,
    });
    updateReviewers({
      artefactId: artefact.id,
      // Keep existing by login, add the new one by uuid (server canonicalizes).
      content: [...toWriteContent(reviewers), { user_uuid: option.uuid }],
      optimisticReviewers: next,
    });
  };

  return (
    <Box>
      <Flex align="center" gap="2" mb="2">
        <Text className="font-medium text-sm">Suggested reviewers</Text>
        {isPending && <Spinner size="1" />}
        <Box flexGrow="1" />
        <Popover.Root
          modal
          open={addOpen}
          onOpenChange={(next) => {
            setAddOpen(next);
            if (!next) setReviewerQuery("");
          }}
        >
          <Popover.Trigger>
            <button
              type="button"
              aria-label="Add suggested reviewer"
              className="flex h-6 items-center gap-1 rounded-sm px-1.5 text-[11px] text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
            >
              <Plus size={12} />
              Add
            </button>
          </Popover.Trigger>
          <Popover.Content
            align="end"
            side="bottom"
            sideOffset={6}
            className="min-w-[280px] max-w-[320px] p-[8px]"
          >
            <Flex direction="column" gap="2">
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
                {isFetching && !availableReviewers?.results?.length ? (
                  <Flex align="center" justify="center" py="3">
                    <Spinner size="1" />
                  </Flex>
                ) : addableOptions.length === 0 ? (
                  <Text color="gray" className="px-1 py-2 text-[12px]">
                    No users found.
                  </Text>
                ) : (
                  <Flex direction="column">
                    {addableOptions.map((option) => {
                      const isAssigned = reviewers.some((r) =>
                        reviewerMatchesAvailable(r, option),
                      );
                      const displayName =
                        getSuggestedReviewerDisplayName(option);
                      return (
                        <button
                          key={option.uuid}
                          type="button"
                          disabled={isPending}
                          className="flex w-full items-start justify-between rounded-sm px-1 py-1 text-left text-[13px] text-gray-12 transition-colors hover:bg-gray-3 focus-visible:bg-gray-3 focus-visible:outline-none disabled:opacity-60"
                          onClick={() => toggleReviewer(option)}
                        >
                          <Flex align="center" gap="2" className="min-w-0">
                            {option.github_login ? (
                              <img
                                src={`https://github.com/${option.github_login}.png?size=32`}
                                alt=""
                                className="github-avatar h-[20px] w-[20px] shrink-0 rounded-full"
                                onLoad={(e) =>
                                  e.currentTarget.classList.add("loaded")
                                }
                              />
                            ) : null}
                            <Flex
                              direction="column"
                              gap="0"
                              className="min-w-0"
                            >
                              <Text className="truncate text-[12px]">
                                {displayName}
                              </Text>
                              {option.email ? (
                                <Text
                                  color="gray"
                                  className="truncate text-[11px]"
                                >
                                  {option.email}
                                </Text>
                              ) : null}
                            </Flex>
                          </Flex>
                          <span
                            className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-12"
                            aria-hidden
                          >
                            {isAssigned ? (
                              <Check size={12} weight="bold" />
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </Flex>
                )}
              </Box>
            </Flex>
          </Popover.Content>
        </Popover.Root>
      </Flex>

      {displayReviewers.length === 0 ? (
        <Text color="gray" className="text-[12px]">
          No reviewers assigned. Use “Add” to suggest one.
        </Text>
      ) : (
        <Flex direction="column" gap="1">
          {displayReviewers.map((reviewer) => {
            const isMe = isRowMe(reviewer, meUuid);
            return (
              <Flex
                key={reviewer.user?.uuid ?? reviewer.github_login}
                align="center"
                gap="2"
                wrap="wrap"
                className="group"
              >
                {reviewer.github_login ? (
                  <img
                    src={`https://github.com/${reviewer.github_login}.png?size=28`}
                    alt=""
                    className="github-avatar h-[18px] w-[18px] shrink-0 rounded-full"
                    onLoad={(e) => e.currentTarget.classList.add("loaded")}
                  />
                ) : null}
                <Text className="text-[12px]">
                  {reviewer.user?.first_name ??
                    reviewer.github_name ??
                    reviewer.github_login}
                </Text>
                {isMe && (
                  <Tooltip content="You are a suggested reviewer">
                    <Badge color="amber" className="!py-1 !text-[8px]">
                      <EyeIcon size={8} weight="bold" className="shrink-0" />
                    </Badge>
                  </Tooltip>
                )}
                {reviewer.github_login ? (
                  <a
                    href={`https://github.com/${reviewer.github_login}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-[11px] text-gray-9 hover:text-gray-11"
                    onClick={() =>
                      fireAction("click_suggested_reviewer", {
                        suggested_reviewer_login: reviewer.github_login,
                      })
                    }
                  >
                    @{reviewer.github_login}
                    <ArrowSquareOutIcon size={10} />
                  </a>
                ) : null}
                {reviewer.relevant_commits.length > 0 && (
                  <span className="text-[11px] text-gray-9">
                    {reviewer.relevant_commits.map((commit, i) => (
                      <span key={commit.sha}>
                        {i > 0 && ", "}
                        <Tooltip
                          content={
                            isMe ? (
                              <Flex direction="column" gap="1">
                                <Text as="div" size="1" weight="bold">
                                  Why was I assigned?
                                </Text>
                                <Text as="div" size="1">
                                  {commit.reason}
                                </Text>
                              </Flex>
                            ) : (
                              commit.reason || undefined
                            )
                          }
                        >
                          <span className="inline-flex items-center gap-0.5">
                            <a
                              href={commit.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-gray-9 hover:text-gray-11"
                            >
                              {commit.sha.slice(0, 7)}
                            </a>
                            {isMe && commit.reason && (
                              <InfoIcon
                                size={11}
                                className="cursor-help text-gray-9"
                              />
                            )}
                          </span>
                        </Tooltip>
                      </span>
                    ))}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${reviewer.github_login || reviewer.user?.first_name || "reviewer"}`}
                  disabled={isPending}
                  onClick={() => removeReviewer(reviewer)}
                  className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-gray-9 opacity-0 transition-opacity hover:bg-gray-3 hover:text-gray-12 focus-visible:opacity-100 disabled:opacity-60 group-hover:opacity-100"
                >
                  <XIcon size={12} />
                </button>
              </Flex>
            );
          })}
        </Flex>
      )}
    </Box>
  );
}
