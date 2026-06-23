import type {
  AgentSessionState,
  AgentUserWithConnections,
} from "@posthog/shared/agent-platform-types";
import { Button } from "@posthog/ui/primitives/Button";
import { Flex, Text } from "@radix-ui/themes";
import { useState } from "react";
import { useAgentApplicationSessions } from "../hooks/useAgentApplicationSessions";
import { useAgentUsers } from "../hooks/useAgentUsers";
import { userDisplayName } from "../utils/format";
import { AgentDetailEmptyState, AgentDetailLayout } from "./AgentDetailLayout";
import { AgentSessionRow } from "./AgentSessionRow";
import { RefreshIndicator } from "./RefreshIndicator";

type Filter = AgentSessionState | "all";

/** Short label for a user in the filter dropdown: display name if the trigger
 *  stamped one, else the principal id, prefixed by kind. */
function userLabel(u: AgentUserWithConnections): string {
  return `${u.principal_kind}: ${userDisplayName(u) ?? u.principal_id}`;
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "queued", label: "Queued" },
];

const PAGE = 25;

/** Per-agent Sessions pane: full session history with a state filter + paging. */
export function AgentSessionsPane({ idOrSlug }: { idOrSlug: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [userId, setUserId] = useState<string>("all");
  const [limit, setLimit] = useState(PAGE);

  const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } =
    useAgentApplicationSessions(idOrSlug, {
      limit,
      state: filter === "all" ? undefined : [filter],
      agent_user_id: userId === "all" ? undefined : userId,
    });

  const { data: usersData } = useAgentUsers(idOrSlug);
  const users = usersData?.results ?? [];

  const sessions = data?.results ?? [];
  const total = data?.count ?? sessions.length;
  const hasMore = sessions.length < total;

  function changeFilter(next: Filter) {
    setFilter(next);
    setLimit(PAGE);
  }

  function changeUser(next: string) {
    setUserId(next);
    setLimit(PAGE);
  }

  return (
    <AgentDetailLayout idOrSlug={idOrSlug} activeTab="sessions">
      <Flex direction="column" gap="4">
        <Flex align="center" justify="between" gap="3">
          <Flex gap="1.5" wrap="wrap">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => changeFilter(f.id)}
                className={`rounded-full border px-3 py-1 text-[12px] ${
                  filter === f.id
                    ? "border-(--accent-7) bg-(--accent-3) text-gray-12"
                    : "border-border text-gray-11 hover:border-(--gray-7)"
                }`}
              >
                {f.label}
              </button>
            ))}
          </Flex>
          <Flex align="center" gap="3" className="shrink-0">
            {users.length > 0 ? (
              <select
                value={userId}
                onChange={(e) => changeUser(e.target.value)}
                aria-label="Filter by user"
                className="rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-2 py-1 text-[12px] text-gray-12"
              >
                <option value="all">All users</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {userLabel(u)}
                  </option>
                ))}
              </select>
            ) : null}
            <RefreshIndicator
              updatedAt={dataUpdatedAt}
              isFetching={isFetching}
              onRefresh={() => void refetch()}
            />
          </Flex>
        </Flex>

        {isLoading ? (
          <Flex direction="column" gap="2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[52px] animate-pulse rounded-(--radius-2) border border-border bg-(--gray-2)"
              />
            ))}
          </Flex>
        ) : isError ? (
          <AgentDetailEmptyState
            title="Couldn't load sessions"
            description="The agent platform API returned an error."
          />
        ) : sessions.length === 0 ? (
          <AgentDetailEmptyState
            title="No sessions"
            description={
              filter === "all"
                ? "This agent hasn't run any sessions yet."
                : "No sessions match this filter."
            }
          />
        ) : (
          <Flex direction="column" gap="2">
            {sessions.map((session) => (
              <AgentSessionRow
                key={session.id}
                session={session}
                idOrSlug={idOrSlug}
              />
            ))}
            <Flex align="center" justify="between" className="pt-1">
              <Text className="text-[11px] text-gray-10">
                Showing {sessions.length} of {total}
              </Text>
              {hasMore ? (
                <Button
                  variant="soft"
                  size="1"
                  onClick={() => setLimit((l) => l + PAGE)}
                  loading={isFetching}
                >
                  Load more
                </Button>
              ) : null}
            </Flex>
          </Flex>
        )}
      </Flex>
    </AgentDetailLayout>
  );
}
