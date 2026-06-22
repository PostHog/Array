import {
  ArrowRightIcon,
  NavigationArrowIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { Button } from "@posthog/ui/primitives/Button";
import { Flex, Text, Tooltip } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { useAuthStateValue } from "../../auth/store";
import { AgentChatPendingApprovalCard } from "../components/AgentChatPendingApprovalCard";
import { AgentChatSurface } from "../components/AgentChatSurface";
import { AgentDetailEmptyState } from "../components/AgentDetailLayout";
import { useAgentApplication } from "../hooks/useAgentApplication";
import { useAgentChat } from "../hooks/useAgentChat";
import { useAgentChatPendingApproval } from "../hooks/useAgentChatPendingApproval";
import { resolveIngressBaseUrl } from "../utils/ingress";
import { AgentBuilderSecretForm } from "./AgentBuilderSecretForm";
import { AgentBuilderSeedDialog } from "./AgentBuilderSeedDialog";
import {
  AGENT_BUILDER_CHAT_ID,
  AGENT_BUILDER_SLUG,
  type AgentBuilderPageContext,
  useAgentBuilderStore,
} from "./agentBuilderStore";
import { suggestionsForPage } from "./agentBuilderSuggestions";
import { useAgentBuilderClientTools } from "./useAgentBuilderClientTools";

const CHAT_ID = AGENT_BUILDER_CHAT_ID;

/** A rotating pool of composer placeholders — picked once per dock mount. */
const BUILDER_PLACEHOLDERS = [
  "Build me an agent that…",
  "What should we build today?",
  "Ask me to inspect, debug, or edit an agent…",
  "Describe an agent and I'll wire it up…",
  "Spin up a new agent, or fix an existing one…",
  "What's broken? Let's debug a session…",
  "Audit the fleet, tweak a prompt, ship an agent…",
  "Tell me what to change…",
];

/** The "what am I looking at" object sent to the agent builder (envelope + get_context). */
function buildAgentBuilderContext(
  page: AgentBuilderPageContext,
  followEnabled: boolean,
  project: { id: number | null; name: string | null; orgId: string | null },
): Record<string, unknown> {
  const agent = "slug" in page ? page.slug : undefined;
  const sessionId = page.kind === "agent-session" ? page.sessionId : undefined;
  return {
    page: page.kind,
    agent,
    session_id: sessionId,
    follow_enabled: followEnabled,
    // The project the user is currently in — the agent threads this into the
    // `project_id` arg of every `@posthog/*` tool (it's tenant-neutral and acts
    // on whatever project we report here).
    project_id: project.id ?? undefined,
    project_name: project.name ?? undefined,
    org_id: project.orgId ?? undefined,
    client: { kind: "posthog-code", version: "1" },
  };
}

/**
 * The Agent Builder chat — an always-on dock talking to the deployed meta-agent
 * (backend slug `agent-builder`). Streams through the shared
 * `useAgentChat`/`AgentChatSurface` stack, prepends the current `/code/agents`
 * page context to the first message, answers `get_context`, and lets the agent
 * drive the UI via `focus_*`.
 */
export function AgentBuilderDock() {
  const { data: application } = useAgentApplication(AGENT_BUILDER_SLUG);
  const cloudRegion = useAuthStateValue((s) => s.cloudRegion);
  const ingressBaseUrl = resolveIngressBaseUrl(
    application?.ingress_base_url,
    cloudRegion,
  );

  const client = useAuthenticatedClient();
  const currentProjectId = useAuthStateValue((s) => s.currentProjectId);
  const currentOrgId = useAuthStateValue((s) => s.currentOrgId);
  const orgProjectsMap = useAuthStateValue((s) => s.orgProjectsMap);
  const projectName =
    currentOrgId != null && currentProjectId != null
      ? (orgProjectsMap[currentOrgId]?.projects.find(
          (p) => p.id === currentProjectId,
        )?.name ?? null)
      : null;
  const page = useAgentBuilderStore((s) => s.page);
  const followMode = useAgentBuilderStore((s) => s.followMode);
  const setFollowMode = useAgentBuilderStore((s) => s.setFollowMode);
  const setVisible = useAgentBuilderStore((s) => s.setVisible);
  const seed = useAgentBuilderStore((s) => s.seed);
  const consumeSeed = useAgentBuilderStore((s) => s.consumeSeed);
  const pendingSecret = useAgentBuilderStore((s) => s.pendingSecret);
  const setPendingSecret = useAgentBuilderStore((s) => s.setPendingSecret);
  const [secretBusy, setSecretBusy] = useState(false);
  const [placeholder] = useState(
    () =>
      BUILDER_PLACEHOLDERS[
        Math.floor(Math.random() * BUILDER_PLACEHOLDERS.length)
      ],
  );

  const clientTools = useAgentBuilderClientTools();
  const chat = useAgentChat({
    chatId: CHAT_ID,
    agentSlug: AGENT_BUILDER_SLUG,
    ingressBaseUrl,
    contextProvider: () =>
      buildAgentBuilderContext(page, followMode, {
        id: currentProjectId,
        name: projectName,
        orgId: currentOrgId,
      }),
    clientTools,
  });
  const { data: pendingApproval } = useAgentChatPendingApproval(
    AGENT_BUILDER_SLUG,
    chat.sessionId,
  );

  // Resolve a pending set_secret: PUT the value straight to the env-keys API
  // (never through the agent), then wake the parked session with the outcome.
  async function submitSecret(value: string) {
    if (!pendingSecret) return;
    setSecretBusy(true);
    try {
      await client.setAgentEnvKey(
        pendingSecret.agentSlug,
        pendingSecret.revisionId,
        pendingSecret.secret,
        value,
      );
      await chat.resolveInteractiveTool(pendingSecret.callId, {
        result: {
          key: pendingSecret.secret,
          action: pendingSecret.mode ?? "set",
        },
      });
      setPendingSecret(null);
    } catch (err) {
      await chat.resolveInteractiveTool(pendingSecret.callId, {
        error: err instanceof Error ? err.message : "set_secret_failed",
      });
      setPendingSecret(null);
    } finally {
      setSecretBusy(false);
    }
  }

  function cancelSecret() {
    if (!pendingSecret) return;
    void chat.resolveInteractiveTool(pendingSecret.callId, {
      error: "user_cancelled",
    });
    setPendingSecret(null);
  }

  // Edit-with-AI hand-offs: send the seeded prompt once when a new seed lands.
  // An empty dock starts immediately; if a chat is already in progress, confirm
  // whether to start fresh or continue (so a deliberate "New agent" / "Edit with
  // AI" doesn't silently wipe or append onto an unrelated conversation).
  const lastSeedRef = useRef(0);
  const [seedConfirm, setSeedConfirm] = useState<string | null>(null);
  useEffect(() => {
    if (!seed || seed.seq === lastSeedRef.current) return;
    lastSeedRef.current = seed.seq;
    consumeSeed(seed.seq);
    if (chat.messages.length === 0) {
      chat.send(seed.prompt);
    } else {
      setSeedConfirm(seed.prompt);
    }
  }, [seed, chat, consumeSeed]);

  function seedStartFresh() {
    if (!seedConfirm) return;
    setPendingSecret(null);
    chat.newChat();
    chat.send(seedConfirm);
    setSeedConfirm(null);
  }
  function seedContinue() {
    if (!seedConfirm) return;
    chat.send(seedConfirm);
    setSeedConfirm(null);
  }

  return (
    <Flex
      direction="column"
      className="h-full min-h-0 border-(--amber-5) border-l-2 bg-(--amber-1)/30"
    >
      <Flex
        align="center"
        gap="2"
        className="shrink-0 border-(--amber-4) border-b bg-(--amber-2)/40 px-3 py-2"
      >
        <SparkleIcon size={15} weight="fill" className="text-(--accent-9)" />
        <Text className="font-medium text-[13px] text-gray-12">
          Agent Builder
        </Text>
        <Flex align="center" gap="2" className="ml-auto">
          <Tooltip
            content={
              followMode
                ? "Following — the agent builder can navigate your screen"
                : "Paused — the agent builder won't navigate"
            }
          >
            <Button
              variant={followMode ? "soft" : "ghost"}
              color={followMode ? undefined : "gray"}
              size="1"
              onClick={() => setFollowMode(!followMode)}
            >
              <NavigationArrowIcon
                size={13}
                weight={followMode ? "fill" : "regular"}
              />
            </Button>
          </Tooltip>
          <Tooltip content="New chat">
            <Button
              variant="ghost"
              color="gray"
              size="1"
              onClick={() => {
                setPendingSecret(null);
                chat.newChat();
              }}
            >
              <PlusIcon size={14} />
            </Button>
          </Tooltip>
          <Tooltip content="Hide agent builder (⌘⇧I)">
            <Button
              variant="ghost"
              color="gray"
              size="1"
              onClick={() => setVisible(false)}
            >
              <SidebarSimpleIcon size={14} />
            </Button>
          </Tooltip>
        </Flex>
      </Flex>

      {!ingressBaseUrl ? (
        <div className="p-4">
          <AgentDetailEmptyState
            title="Agent Builder unavailable"
            description="The Agent Builder deployment has no reachable ingress in this environment."
          />
        </div>
      ) : (
        <AgentChatSurface
          messages={chat.messages}
          isStreaming={chat.isStreaming}
          error={chat.error}
          scrollX={false}
          placeholder={placeholder}
          emptyState={<AgentBuilderEmptyState page={page} onPick={chat.send} />}
          emptyHint="Ask the agent builder to inspect, debug, or edit your agents. It can see what you're looking at and walk you there."
          belowConversation={
            pendingApproval ? (
              <AgentChatPendingApprovalCard
                idOrSlug={AGENT_BUILDER_SLUG}
                approval={pendingApproval}
                decide={chat.decideApproval}
              />
            ) : null
          }
          aboveComposer={
            pendingSecret ? (
              <AgentBuilderSecretForm
                pending={pendingSecret}
                busy={secretBusy}
                onSubmit={submitSecret}
                onCancel={cancelSecret}
              />
            ) : null
          }
          composerDisabledReason={
            pendingApproval ? "Waiting on your approval decision" : undefined
          }
          onSend={chat.send}
          onCancel={chat.cancel}
        />
      )}

      <AgentBuilderSeedDialog
        open={seedConfirm != null}
        prompt={seedConfirm ?? ""}
        onStartFresh={seedStartFresh}
        onContinue={seedContinue}
        onCancel={() => setSeedConfirm(null)}
      />
    </Flex>
  );
}

/** Empty-dock state: a short prompt plus page-aware starter suggestions. */
function AgentBuilderEmptyState({
  page,
  onPick,
}: {
  page: AgentBuilderPageContext;
  onPick: (prompt: string) => void;
}) {
  const suggestions = suggestionsForPage(page);
  return (
    <Flex direction="column" className="h-full min-h-0 justify-end gap-3 p-3">
      <Text className="px-1 text-[12px] text-gray-10 leading-snug">
        Ask the agent builder to inspect, debug, or edit your agents — it can
        see what you're looking at and walk you there. Try:
      </Text>
      <Flex direction="column" className="gap-2.5">
        {suggestions.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.prompt)}
            className="group flex items-center gap-2 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-2) px-3 py-2 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-3)"
          >
            <SparkleIcon
              size={13}
              weight="fill"
              className="shrink-0 text-(--accent-9)"
            />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-12">
              {s.label}
            </span>
            <ArrowRightIcon
              size={12}
              className="shrink-0 text-gray-8 transition-colors group-hover:text-gray-11"
            />
          </button>
        ))}
      </Flex>
    </Flex>
  );
}
