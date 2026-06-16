import {
  ChatCircleIcon,
  InfoIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { CloudRegion } from "@posthog/shared";
import { Button } from "@posthog/ui/primitives/Button";
import { Flex, Text } from "@radix-ui/themes";
import { useAuthStateValue } from "../../auth/store";
import {
  type PreviewChatEntry,
  useChatHistoryStore,
} from "../chat/chatHistoryStore";
import { useAgentApplication } from "../hooks/useAgentApplication";
import { useAgentChat } from "../hooks/useAgentChat";
import { useAgentChatPendingApproval } from "../hooks/useAgentChatPendingApproval";
import { useAgentRevision } from "../hooks/useAgentRevision";
import { resolveIngressBaseUrl } from "../utils/ingress";
import { AgentChatPendingApprovalCard } from "./AgentChatPendingApprovalCard";
import { AgentChatSurface } from "./AgentChatSurface";
import { AgentDetailEmptyState, AgentDetailLayout } from "./AgentDetailLayout";

const EMPTY_CHATS: PreviewChatEntry[] = [];

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Compact "x ago" for the rail, from an epoch-ms timestamp. */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Live chat against a deployed agent (the console's "preview/test"). Streams the
 * agent-ingress SSE through the native `ConversationView`. Only meaningful for
 * agents that expose a chat trigger and have a public ingress URL.
 *
 * A left rail lists the preview chats the user started *here* (persisted
 * locally — never the agent's full server session list, which can include real
 * customer chats), and a banner makes clear this talks to the deployed revision.
 */
export function AgentChatPane({ idOrSlug }: { idOrSlug: string }) {
  const { data: application } = useAgentApplication(idOrSlug);
  const { data: revision } = useAgentRevision(
    idOrSlug,
    application?.live_revision ?? null,
  );
  const cloudRegion = useAuthStateValue((s) => s.cloudRegion);
  const ingressBaseUrl = resolveIngressBaseUrl(
    application?.ingress_base_url,
    cloudRegion,
  );
  const hasChatTrigger = (revision?.spec?.triggers ?? []).some(
    (t) => rec(t).type === "chat",
  );
  const chat = useAgentChat({
    chatId: `preview:${idOrSlug}`,
    agentSlug: idOrSlug,
    ingressBaseUrl,
    recordHistory: true,
  });
  const { data: pendingApproval } = useAgentChatPendingApproval(
    idOrSlug,
    chat.sessionId,
  );
  const chats = useChatHistoryStore((s) => s.byAgent[idOrSlug]) ?? EMPTY_CHATS;
  const removeChat = useChatHistoryStore((s) => s.remove);

  return (
    <AgentDetailLayout idOrSlug={idOrSlug} activeTab="chat" fill>
      {!ingressBaseUrl ? (
        <div className="p-6">
          <AgentDetailEmptyState
            title="No ingress URL"
            description="This deployment has no public ingress URL, so the agent can't be reached for a live chat."
          />
        </div>
      ) : !hasChatTrigger ? (
        <div className="p-6">
          <AgentDetailEmptyState
            title="No chat trigger"
            description="This agent's live revision doesn't expose a chat trigger, so there's nothing to chat with. Add a chat trigger via the agent builder to test it here."
          />
        </div>
      ) : (
        <Flex className="h-full min-h-0">
          <ChatHistoryRail
            chats={chats}
            activeSessionId={chat.sessionId}
            onNewChat={chat.newChat}
            onSelect={chat.resume}
            onDelete={(sessionId) => removeChat(idOrSlug, sessionId)}
          />
          <Flex direction="column" className="min-w-0 flex-1">
            <PreviewBanner
              revisionId={application?.live_revision ?? null}
              model={revision?.spec?.model}
              region={cloudRegion}
            />
            <AgentChatSurface
              messages={chat.messages}
              isStreaming={chat.isStreaming}
              error={chat.error}
              emptyHint="Send a message to start a session and test this agent live."
              belowConversation={
                pendingApproval ? (
                  <AgentChatPendingApprovalCard
                    idOrSlug={idOrSlug}
                    approval={pendingApproval}
                  />
                ) : null
              }
              composerDisabledReason={
                pendingApproval
                  ? "Waiting on your approval decision"
                  : undefined
              }
              onSend={chat.send}
              onCancel={chat.cancel}
            />
          </Flex>
        </Flex>
      )}
    </AgentDetailLayout>
  );
}

function PreviewBanner({
  revisionId,
  model,
  region,
}: {
  revisionId: string | null;
  model: string | undefined;
  region: CloudRegion | null;
}) {
  return (
    <Flex
      align="center"
      gap="2"
      className="shrink-0 border-(--gray-5) border-b bg-(--gray-2) px-4 py-2"
    >
      <InfoIcon size={14} className="shrink-0 text-gray-10" />
      <Text className="text-[12px] text-gray-11 leading-snug">
        Live preview — messages run against the currently deployed revision.
        Only chats you start here appear in the list.
      </Text>
      <Flex align="center" gap="2" className="ml-auto shrink-0">
        {model ? (
          <Text className="text-[11px] text-gray-10">{model}</Text>
        ) : null}
        {revisionId ? (
          <Text
            className="font-mono text-[11px] text-gray-10"
            title={revisionId}
          >
            rev {revisionId.slice(0, 8)}
          </Text>
        ) : null}
        {region ? (
          <Text className="text-[11px] text-gray-10 uppercase">{region}</Text>
        ) : null}
      </Flex>
    </Flex>
  );
}

function ChatHistoryRail({
  chats,
  activeSessionId,
  onNewChat,
  onSelect,
  onDelete,
}: {
  chats: PreviewChatEntry[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}) {
  return (
    <Flex
      direction="column"
      className="w-56 shrink-0 border-(--gray-5) border-r"
    >
      <div className="shrink-0 p-2">
        <Button
          variant="soft"
          color="gray"
          size="1"
          className="w-full justify-start"
          onClick={onNewChat}
        >
          <PlusIcon size={13} />
          New chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {chats.length === 0 ? (
          <Text className="block px-1 py-2 text-[11.5px] text-gray-9 leading-snug">
            Chats you start here will show up in this list.
          </Text>
        ) : (
          <Flex direction="column" gap="1">
            {chats.map((c) => {
              const active = c.sessionId === activeSessionId;
              return (
                <div key={c.sessionId} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelect(c.sessionId)}
                    className={`flex w-full items-start gap-2 rounded-(--radius-2) py-1.5 pr-7 pl-2 text-left ${
                      active ? "bg-(--accent-3)" : "hover:bg-(--gray-3)"
                    }`}
                  >
                    <ChatCircleIcon
                      size={13}
                      className="mt-0.5 shrink-0 text-gray-10"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-gray-12 leading-tight">
                        {c.title || "Untitled chat"}
                      </span>
                      <span className="block text-[10.5px] text-gray-9">
                        {relativeTime(c.startedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="Remove chat"
                    onClick={() => onDelete(c.sessionId)}
                    className="absolute top-1.5 right-1 rounded p-0.5 text-gray-9 opacity-0 hover:text-gray-12 group-hover:opacity-100"
                  >
                    <TrashIcon size={12} />
                  </button>
                </div>
              );
            })}
          </Flex>
        )}
      </div>
    </Flex>
  );
}
