import { resolveChatDir, useChatDir } from "@features/chat/hooks/useChatDir";
import { useChatStore } from "@features/chat/stores/chatStore";
import { PromptInput } from "@features/message-editor/components/PromptInput";
import type { EditorHandle } from "@features/message-editor/types";
import { ReasoningLevelSelector } from "@features/sessions/components/ReasoningLevelSelector";
import { SessionView } from "@features/sessions/components/SessionView";
import { UnifiedModelSelector } from "@features/sessions/components/UnifiedModelSelector";
import { useSessionCallbacks } from "@features/sessions/hooks/useSessionCallbacks";
import { useSessionConnection } from "@features/sessions/hooks/useSessionConnection";
import {
  sessionStoreSetters,
  useSessionForTask,
} from "@features/sessions/stores/sessionStore";
import {
  type AgentAdapter,
  useSettingsStore,
} from "@features/settings/stores/settingsStore";
import { usePreviewConfig } from "@features/task-detail/hooks/usePreviewConfig";
import type {
  TaskCreationInput,
  TaskService,
} from "@features/task-detail/service/service";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import { ChatCircleText, CircleNotch } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { get as getDi } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { trpcClient } from "@renderer/trpc/client";
import type { Task } from "@shared/types";
import type { WorkProject } from "@shared/types/work-projects";
import { useProjectChatsStore } from "@stores/projectChatsStore";
import { logger } from "@utils/logger";
import { queryClient } from "@utils/queryClient";
import { toast } from "@utils/toast";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectChatEcho } from "./ProjectChatEcho";

const log = logger.scope("project-chat-panel");

function newChatId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `chat-${Date.now()}`;
}

function summarizeTilesForPrompt(project: WorkProject): string {
  const lines: string[] = [];
  for (const t of project.tiles) {
    if (t.type === "title") continue;
    if (t.type === "headline") {
      lines.push(
        `- headline · ${t.label}: ${t.fallbackValue} (${t.fallbackDelta})${
          t.posthogUrl ? ` — ${t.posthogUrl}` : ""
        }`,
      );
    } else if (t.type === "insight") {
      lines.push(
        `- insight · ${t.title}${t.description ? ` — ${t.description}` : ""} (${t.url})`,
      );
    } else if (t.type === "file") {
      const label = t.title ?? "Files";
      lines.push(
        `- files · ${label} (${t.items.length} item${t.items.length === 1 ? "" : "s"})`,
      );
    } else if (t.type === "note") {
      lines.push(`- note · ${t.body.slice(0, 80)}`);
    }
  }
  return lines.length > 0
    ? lines.join("\n")
    : "(no content tiles yet — the canvas is empty besides the title)";
}

/**
 * Builds the system-prompt appendix the agent sees when running inside a
 * PostHog Code project chat. Threaded via the `customInstructions` field on
 * `agent.start.mutate` → `buildSystemPrompt({ append })`. Tells the agent
 * which project it's in, what tiles already exist, what canvas tools it has,
 * and how to drive the workflow.
 */
function buildProjectSystemPrompt(project: WorkProject): string {
  return `# PostHog Code project chat — special tool environment

You are running INSIDE a PostHog Code project canvas. A custom MCP server
called \`projectCanvas\` is attached to this session. **Its tools ARE
available** — do not search for them, do not say they aren't available, do
not suggest alternatives. Just call them. If a tool name like
\`mcp__projectCanvas__propose_tile_headline\` doesn't autocomplete, it's
still callable — invoke it directly.

## This project
- id: ${project.id}
- name: ${project.name}
- tagline: ${project.tagline}

Every canvas tool requires \`projectId\` — always pass exactly:
\`projectId: "${project.id}"\`

## Tiles already on the canvas
${summarizeTilesForPrompt(project)}

## Canvas tools (call these — they exist)
- \`mcp__projectCanvas__get_current_canvas\` — read the live canvas state
  right now. Call this at the start of turns 2+ so you see whatever the user
  has accepted, rejected, edited, or added since the conversation started.
  The system-prompt tile list above is from the moment the chat began —
  it's stale after any user action.
- \`mcp__projectCanvas__propose_tile_headline\` — big metrics with a short
  delta (e.g. signup conversion %, WAU, error rate). Arrives as a ghost
  tile for the user to accept/reject.
- \`mcp__projectCanvas__propose_tile_insight\` — links to a real PostHog
  dashboard or insight URL. Use when you can point at an existing or
  newly-saved artifact in PostHog.
- \`mcp__projectCanvas__propose_tile_file\` — markdown writeups: findings,
  hypotheses, briefs. Bullets > paragraphs. ≤ ~1500 chars.
- \`mcp__projectCanvas__propose_tile_note\` — short sticky-note callouts
  (≤ 280 chars). Don't dump prose here — that's what file tiles are for.
- \`mcp__projectCanvas__propose_tile_artifact\` — rich tile with multiple
  renderers. ONE tool, FIVE shapes via the \`kind\` field:
  - kind="checklist": data = { items: [{ text: string, done: boolean }, …] }
    — the user can tick items off live.
  - kind="table": data = { headers: string[], rows: string[][] } — read-only.
  - kind="chart": data = { chartKind: "bar"|"line", series: [{ label, value }, …], unit?: string }
    — inline bar or line. Great for funnel breakdowns, top-N lists.
  - kind="code": data = { language: string, body: string } — fenced code.
  - kind="embed": data = { url: string, description?: string } — link-out card.
  Skills running in this chat can also call this — it's the right way to
  surface structured findings rich-fully.
- \`mcp__projectCanvas__update_project_meta\` — rename the project / change
  the icon (rocket, microphone, megaphone, lightbulb, compass, target,
  flask). Use sparingly.
- \`mcp__projectCanvas__set_next_steps\` — MANDATORY at end of every turn.
  Set 2–3 short imperative follow-up prompts (each ≤ 80 chars) for the user
  to click. e.g. ["Segment funnel by traffic source", "Drill into email
  confirm step", "Compare mobile vs desktop drop-off"].

## How to work
1. Use the PostHog MCP tools (\`mcp__posthog__*\`) to query real data. Don't
   make up numbers. If you genuinely lack context, ask ONE short clarifying
   question — otherwise just run.
2. As findings emerge, propose tiles via the canvas tools. Propose generously
   — every tile is a ghost the user can reject in one click.
3. End EVERY turn by calling \`set_next_steps\`. No exceptions.
4. Keep chat replies tight (≤ 6 sentences). The canvas holds the artifacts;
   the chat narrates progress.

## A good first turn looks like
Query PostHog. Propose 2–3 tiles (e.g. one headline + one insight + one
file with findings). Narrate what you found in 3–4 sentences. Call
\`set_next_steps\`. Don't ask permission to start — just go.`;
}

function ProjectChatLanding({ project }: { project: WorkProject }) {
  const editorRef = useRef<EditorHandle>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorIsEmpty, setEditorIsEmpty] = useState(true);

  const addChat = useChatStore((s) => s.addChat);
  const setChatId = useProjectChatsStore((s) => s.setChatId);

  const lastUsedAdapter = useSettingsStore((s) => s.lastUsedAdapter);
  const setLastUsedAdapter = useSettingsStore((s) => s.setLastUsedAdapter);
  const setLastUsedReasoningEffort = useSettingsStore(
    (s) => s.setLastUsedReasoningEffort,
  );
  const adapter: AgentAdapter = lastUsedAdapter ?? "claude";

  const {
    modelOption,
    thoughtOption,
    isLoading: isPreviewLoading,
    setConfigOption,
  } = usePreviewConfig(adapter);

  const handleModelChange = useCallback(
    (value: string) => {
      if (modelOption) setConfigOption(modelOption.id, value);
    },
    [modelOption, setConfigOption],
  );

  const handleThoughtChange = useCallback(
    (value: string) => {
      if (thoughtOption) {
        setConfigOption(thoughtOption.id, value);
        setLastUsedReasoningEffort(value);
      }
    },
    [thoughtOption, setConfigOption, setLastUsedReasoningEffort],
  );

  const handleSubmit = useCallback(
    async (text: string) => {
      const userPrompt = text.trim();
      if (!userPrompt || isSubmitting) return;
      setIsSubmitting(true);

      const chatId = newChatId();
      const title = `${project.name} · chat`;

      try {
        const repoPath = await resolveChatDir(chatId);

        const model =
          modelOption?.type === "select" ? modelOption.currentValue : undefined;
        const reasoningLevel =
          thoughtOption?.type === "select"
            ? thoughtOption.currentValue
            : undefined;

        const input: TaskCreationInput = {
          content: userPrompt,
          taskDescription: title,
          repoPath,
          workspaceMode: "chat",
          adapter,
          model,
          reasoningLevel,
          projectCanvasId: project.id,
          customInstructions: buildProjectSystemPrompt(project),
        };

        const taskService = getDi<TaskService>(RENDERER_TOKENS.TaskService);
        const result = await taskService.createTask(input, (output) => {
          addChat(output.task.id);
          setChatId(project.id, output.task.id);
          queryClient.setQueriesData<Task[]>(
            { queryKey: ["tasks", "list"] },
            (old) =>
              old
                ? [output.task, ...old.filter((t) => t.id !== output.task.id)]
                : [output.task],
          );
          void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        });

        if (!result.success) {
          toast.error("Failed to start chat", { description: result.error });
          log.error("Project chat creation failed", {
            projectId: project.id,
            failedStep: result.failedStep,
            error: result.error,
          });
        }
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "Unknown error";
        toast.error("Failed to start chat", { description });
        log.error("Unexpected error starting project chat", {
          projectId: project.id,
          error,
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      isSubmitting,
      project,
      adapter,
      modelOption,
      thoughtOption,
      addChat,
      setChatId,
    ],
  );

  const handleEditorEmptyChange = useCallback((isEmpty: boolean) => {
    setEditorIsEmpty(isEmpty);
  }, []);

  // Auto-fire a starter prompt set at project creation. Clear it on the server
  // before firing so it never replays after navigation/reload; a ref guards
  // against re-firing within the same mount if the project re-renders before
  // the chat panel switches to ProjectChatSession.
  const autoFiredRef = useRef(false);
  const [isAutoFiring, setIsAutoFiring] = useState(false);
  useEffect(() => {
    const pending = project.pendingPrompt?.trim();
    if (!pending || autoFiredRef.current || isSubmitting) return;
    autoFiredRef.current = true;
    setIsAutoFiring(true);
    void trpcClient.workProjects.clearPendingPrompt
      .mutate({ projectId: project.id })
      .catch((error: unknown) => {
        log.warn("Failed to clear pending prompt", {
          projectId: project.id,
          error,
        });
      });
    void handleSubmit(pending).finally(() => setIsAutoFiring(false));
  }, [project.id, project.pendingPrompt, isSubmitting, handleSubmit]);

  const handleSubmitClick = useCallback(() => {
    const text = editorRef.current?.getText() ?? "";
    void handleSubmit(text);
  }, [handleSubmit]);

  if (isAutoFiring) {
    return (
      <Flex direction="column" height="100%">
        <Flex
          align="center"
          gap="2"
          px="3"
          py="2"
          className="shrink-0 border-(--gray-6) border-b text-(--gray-11)"
        >
          <ChatCircleText size={14} weight="duotone" />
          <Text
            as="span"
            weight="medium"
            className="text-(--gray-12) text-[13px]"
          >
            {project.name}
          </Text>
        </Flex>
        <Flex
          flexGrow="1"
          align="center"
          justify="center"
          direction="column"
          gap="2"
          className="px-4"
        >
          <CircleNotch
            size={20}
            weight="bold"
            className="animate-spin text-(--gray-10)"
          />
          <Text as="div" className="text-(--gray-11) text-[13px]">
            Kicking off your chat…
          </Text>
        </Flex>
      </Flex>
    );
  }

  return (
    <Flex direction="column" height="100%">
      <Flex
        align="center"
        gap="2"
        px="3"
        py="2"
        className="shrink-0 border-(--gray-6) border-b text-(--gray-11)"
      >
        <ChatCircleText size={14} weight="duotone" />
        <Text
          as="span"
          weight="medium"
          className="text-(--gray-12) text-[13px]"
        >
          Ask about {project.name}
        </Text>
      </Flex>
      <Flex
        flexGrow="1"
        align="center"
        justify="end"
        direction="column"
        className="overflow-y-auto px-4 pb-4"
      >
        <Flex direction="column" gap="3" className="w-full max-w-[560px]">
          <Text as="div" className="text-(--gray-11) text-[13px]">
            Ask anything about {project.name} — I have its dashboards,
            automations, and files in context.
          </Text>
          <PromptInput
            ref={editorRef}
            sessionId={`project-chat-landing-${project.id}`}
            placeholder={`e.g. summarize today's waitlist signups for the launch standup`}
            editorHeight="default"
            disabled={isSubmitting}
            isLoading={isSubmitting}
            autoFocus
            clearOnSubmit={false}
            submitDisabledExternal={editorIsEmpty || isSubmitting}
            enableCommands
            enableBashMode={false}
            modelSelector={
              <UnifiedModelSelector
                modelOption={modelOption}
                adapter={adapter}
                onAdapterChange={setLastUsedAdapter}
                disabled={isSubmitting}
                isConnecting={isPreviewLoading}
                onModelChange={handleModelChange}
              />
            }
            reasoningSelector={
              !isPreviewLoading && (
                <ReasoningLevelSelector
                  thoughtOption={thoughtOption}
                  adapter={adapter}
                  onChange={handleThoughtChange}
                  disabled={isSubmitting}
                />
              )
            }
            onEmptyChange={handleEditorEmptyChange}
            onSubmitClick={handleSubmitClick}
            onSubmit={handleSubmit}
          />
        </Flex>
      </Flex>
    </Flex>
  );
}

function ProjectChatSession({
  project,
  chatId,
}: {
  project: WorkProject;
  chatId: string;
}) {
  const { data: tasks } = useTasks();
  const repoPath = useChatDir(chatId);

  const taskFromList = useMemo(
    () => tasks?.find((t) => t.id === chatId),
    [tasks, chatId],
  );

  const { data: taskFromApi } = useAuthenticatedQuery<Task>(
    ["tasks", "detail", chatId],
    (client) => client.getTask(chatId) as unknown as Promise<Task>,
    { enabled: !taskFromList },
  );

  const task = taskFromList ?? taskFromApi;
  const session = useSessionForTask(chatId);

  // Render the panel even before task data has resolved so the input is
  // interactive on the very first frame. `useSessionConnection` and
  // `useSessionCallbacks` already accept a placeholder shape during that
  // brief window.
  const taskOrPlaceholder = task ?? ({ id: chatId } as Task);

  useSessionConnection({
    taskId: chatId,
    task: taskOrPlaceholder,
    session,
    repoPath: repoPath ?? null,
    isCloud: false,
  });

  const {
    handleSendPrompt,
    handleCancelPrompt,
    handleRetry,
    handleNewSession,
    handleBashCommand,
  } = useSessionCallbacks({
    taskId: chatId,
    task: taskOrPlaceholder,
    session,
    repoPath: repoPath ?? null,
  });

  const events = session?.events ?? [];
  const isPromptPending = session?.isPromptPending ?? false;
  const promptStartedAt = session?.promptStartedAt;
  const isRunning = session?.status === "connected";
  const hasError = session?.status === "error" && !session?.idleKilled;
  const isInitializing =
    !session ||
    (session.status === "connecting" && events.length === 0) ||
    (session.status === "connected" &&
      events.length === 0 &&
      (isPromptPending || !!task?.latest_run?.id));

  // Pre-connection queue: messages submitted while the session is not yet
  // `"connected"` are held here, rendered as faded ghost bubbles, and
  // flushed once the agent comes online. With pre-warming this queue is
  // usually empty; it covers the cold-start gap when the user beats the
  // connection.
  const [pendingPreConnect, setPendingPreConnect] = useState<string[]>([]);

  const handleSendPromptOrQueue = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt) return;
      if (isRunning) {
        await handleSendPrompt(prompt);
        return;
      }
      setPendingPreConnect((prev) => [...prev, prompt]);
      const taskRunId = session?.taskRunId;
      if (taskRunId) {
        sessionStoreSetters.appendOptimisticItem(taskRunId, {
          type: "user_message",
          content: prompt,
          timestamp: Date.now(),
          pending: true,
        });
      }
    },
    [isRunning, handleSendPrompt, session?.taskRunId],
  );

  // Drain the pre-connection queue the moment the agent reports connected.
  // Uses a ref + the `pendingPreConnect` length so the effect doesn't loop
  // when the optimistic items are cleared.
  const drainGuardRef = useRef(false);
  useEffect(() => {
    if (!isRunning) {
      drainGuardRef.current = false;
      return;
    }
    if (drainGuardRef.current) return;
    if (pendingPreConnect.length === 0) return;
    drainGuardRef.current = true;
    const combined = pendingPreConnect.join("\n\n");
    setPendingPreConnect([]);
    const taskRunId = session?.taskRunId;
    if (taskRunId) {
      sessionStoreSetters.clearPendingOptimisticItems(taskRunId);
    }
    void handleSendPrompt(combined);
  }, [isRunning, pendingPreConnect, session?.taskRunId, handleSendPrompt]);

  const handleNextStepClick = (prompt: string) => {
    void trpcClient.workProjects.clearNextSteps
      .mutate({ projectId: project.id })
      .catch((err: unknown) => {
        log.warn("Failed to clear next steps", { err });
      });
    void handleSendPromptOrQueue(prompt);
  };

  return (
    <Flex direction="column" height="100%">
      <Flex
        align="center"
        gap="2"
        px="3"
        py="2"
        className="shrink-0 border-(--gray-6) border-b text-(--gray-11)"
      >
        <ChatCircleText size={14} weight="duotone" />
        <Text
          as="span"
          weight="medium"
          className="truncate text-(--gray-12) text-[13px]"
        >
          {project.name}
        </Text>
      </Flex>
      {project.nextSteps &&
        project.nextSteps.length > 0 &&
        !isPromptPending && (
          <Flex
            align="center"
            gap="1.5"
            px="3"
            py="2"
            className="scrollbar-overlay-x shrink-0 overflow-x-auto border-(--gray-6) border-b bg-(--gray-2)"
          >
            <Text
              as="span"
              className="shrink-0 text-(--gray-10) text-[10px] uppercase tracking-wide"
            >
              Try next
            </Text>
            {project.nextSteps.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => handleNextStepClick(step)}
                className="shrink-0 cursor-pointer rounded-full border border-(--gray-5) bg-(--gray-1) px-2.5 py-0.5 text-(--gray-12) text-[11px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-3)"
                title={step}
              >
                {step}
              </button>
            ))}
          </Flex>
        )}
      <Box flexGrow="1" overflow="hidden" position="relative">
        <SessionView
          events={events}
          taskId={chatId}
          task={task}
          isRunning={isRunning}
          isPromptPending={isPromptPending}
          promptStartedAt={promptStartedAt}
          onSendPrompt={handleSendPromptOrQueue}
          onBashCommand={handleBashCommand}
          onCancelPrompt={handleCancelPrompt}
          repoPath={repoPath ?? undefined}
          hasError={hasError}
          errorTitle={session?.errorTitle}
          errorMessage={session?.errorMessage ?? undefined}
          onRetry={handleRetry}
          onNewSession={handleNewSession}
          isInitializing={isInitializing}
          isCloud={false}
          compact
          isActiveSession
          instantInteractive
        />
        {events.length === 0 &&
          !isRunning &&
          pendingPreConnect.length === 0 && (
            <Box className="pointer-events-none absolute inset-x-0 top-0">
              <ProjectChatEcho project={project} />
            </Box>
          )}
      </Box>
    </Flex>
  );
}

export function ProjectChatPanel({ project }: { project: WorkProject }) {
  const chatId = useProjectChatsStore((s) => s.chatIdByProjectId[project.id]);

  if (!chatId) {
    return <ProjectChatLanding project={project} />;
  }
  return <ProjectChatSession project={project} chatId={chatId} />;
}
