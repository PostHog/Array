import { agentChatStore } from "@posthog/core/agent-chat/agentChatStore";
import type { AgentSessionEvent } from "@posthog/shared/agent-platform-types";
import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { toast } from "@posthog/ui/primitives/toast";
import { useCallback, useEffect, useRef } from "react";
import { useStore } from "zustand";
import { useChatHistoryStore } from "../chat/chatHistoryStore";
import { buildConsoleContextEnvelope } from "../chat/consoleContext";
import { conversationToAcpMessages } from "../chat/conversationToAcp";
import {
  type AgentChatMapper,
  createAgentChatMapper,
} from "../chat/sessionEventToAcp";

type ClientToolCall = Extract<
  AgentSessionEvent,
  { kind: "client_tool_call" }
>["data"];

/**
 * A client-tool result. `defer: true` means the call is interactive (e.g.
 * `set_secret`): the handler opened a UI and will post the outcome itself via
 * `resolveInteractiveTool`, so the dispatcher must NOT post a result now.
 */
export type ClientToolOutcome = {
  result?: unknown;
  error?: string;
  defer?: boolean;
};

/**
 * Resolves a client-tool call, or returns null to defer to the built-in
 * handlers (toast / get_context). Used by the agent builder to drive the UI
 * (focus_*) and the secret punch-out.
 */
export type ClientToolHandler = (
  data: ClientToolCall,
) => ClientToolOutcome | null | Promise<ClientToolOutcome | null>;

/** Session states with no further activity to tail — render stored history only. */
const TERMINAL_SESSION_STATES = new Set([
  "completed",
  "closed",
  "cancelled",
  "failed",
]);

export interface UseAgentChatOptions {
  /** Opaque key isolating this chat in the store (e.g. "agent-builder", "preview:<slug>"). */
  chatId: string;
  /** Agent slug the chat targets (drives client-tool context + history). */
  agentSlug: string;
  ingressBaseUrl: string | null;
  /**
   * When set, this chat targets a specific non-live revision. The hook mints a
   * short-lived preview token via the api-client and attaches it on every
   * ingress call (run/send/listen/cancel/client_tool_result). Leave null/unset
   * to use the agent's currently live revision.
   */
  revisionId?: string | null;
  /** Index started sessions in the local recent-chats rail (preview only). */
  recordHistory?: boolean;
  /**
   * Supplies the "what am I looking at" object. When set, it's prepended as a
   * delimited envelope to the first message and answers the `get_context`
   * client tool. AgentBuilder only.
   */
  contextProvider?: () => unknown;
  /** AgentBuilder UI-driving tools (focus_*, set_secret); null → built-in handling. */
  clientTools?: ClientToolHandler;
}

/** Reserve a margin so we mint a fresh token before the server rejects the old one. */
const PREVIEW_TOKEN_EARLY_REFRESH_MS = 30_000;

interface CachedPreviewToken {
  token: string;
  expiresAtMs: number;
}

/**
 * Recognize the fetcher's `Failed request: [401] …` shape (the ingress signals
 * an expired/missing preview token the same way it signals any other auth
 * failure). Anything else falls through to the caller as a normal error.
 */
function isPreviewAuthError(err: unknown): boolean {
  return err instanceof Error && /\[401\]/.test(err.message);
}

/**
 * Drives a live chat against a deployed agent's ingress: starts/sends/cancels
 * via the api-client, streams SSE through the M3 `createAgentChatMapper`, and
 * pumps the resulting ACP messages into the core `agentChatStore` under `chatId`
 * (so the agent builder dock and a per-agent preview coexist). Components read the
 * chat by id and render through `ConversationView`.
 *
 * Transport lives here (the api-client is renderer/hook-scoped); state lives in
 * core. Client tools are dispatched here — `toast`/`get_context` are handled;
 * `focus_*`/`set_secret` degrade to `unhandled_client_tool` until the agent builder
 * milestone wires UI-driving + the inline secret form.
 */
export function useAgentChat({
  chatId,
  agentSlug,
  ingressBaseUrl,
  revisionId = null,
  recordHistory = false,
  contextProvider,
  clientTools,
}: UseAgentChatOptions) {
  const client = useAuthenticatedClient();
  const chat = useStore(agentChatStore, (s) => s.chats[chatId]);
  const recordChat = useChatHistoryStore((s) => s.record);
  const mapperRef = useRef<AgentChatMapper>(createAgentChatMapper());
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  // Latest provider/handler without re-creating the stream callbacks each render.
  const contextProviderRef = useRef(contextProvider);
  contextProviderRef.current = contextProvider;
  const clientToolsRef = useRef(clientTools);
  clientToolsRef.current = clientTools;
  // Each stream attach bumps this; an aborted/superseded loop checks it before
  // touching the store so a stale loop's terminal/finally can't clobber the new
  // chat (matters when resuming or starting a new chat mid-stream).
  const epochRef = useRef(0);
  // Cached preview token for a draft-revision session. Lazily minted on the
  // first ingress call so chats against the live revision pay nothing.
  const previewTokenRef = useRef<CachedPreviewToken | null>(null);
  // Drop the cached token if the consumer flips revisions (incl. live ↔ draft):
  // a token is bound to a specific (app, revision), so a stale one wouldn't
  // route to the new target.
  const revisionRef = useRef<string | null>(revisionId);
  if (revisionRef.current !== revisionId) {
    revisionRef.current = revisionId;
    previewTokenRef.current = null;
  }

  /**
   * Mint a preview token if we don't have one, or refresh it just before
   * expiry. `force` skips the cache (used on the post-401 retry path).
   * Returns null when the chat targets the live revision.
   */
  const getPreviewToken = useCallback(
    async (force = false): Promise<string | null> => {
      if (!revisionId) return null;
      const cached = previewTokenRef.current;
      if (
        !force &&
        cached &&
        cached.expiresAtMs - Date.now() > PREVIEW_TOKEN_EARLY_REFRESH_MS
      ) {
        return cached.token;
      }
      const minted = await client.mintAgentPreviewToken(agentSlug, revisionId);
      previewTokenRef.current = {
        token: minted.token,
        // Backend returns TTL in seconds; convert to an absolute deadline so
        // the early-refresh comparison is straight subtraction.
        expiresAtMs: Date.now() + minted.expires_in * 1000,
      };
      return minted.token;
    },
    [client, agentSlug, revisionId],
  );

  /**
   * Run an ingress call with the cached preview token. On the fetcher's
   * `[401]` shape, mint a fresh token and retry the call exactly once — covers
   * both the silent-expiry case and a server-side rotation we missed. For
   * non-preview chats this is just `call(null)`.
   */
  const withPreviewToken = useCallback(
    async <T>(call: (token: string | null) => Promise<T>): Promise<T> => {
      const token = await getPreviewToken();
      try {
        return await call(token);
      } catch (err) {
        if (!revisionId || !isPreviewAuthError(err)) throw err;
        const fresh = await getPreviewToken(true);
        return call(fresh);
      }
    },
    [getPreviewToken, revisionId],
  );

  const dispatchClientTool = useCallback(
    async (
      data: Extract<AgentSessionEvent, { kind: "client_tool_call" }>["data"],
      sessionId: string,
    ) => {
      if (!ingressBaseUrl) return;
      // 1) agent builder handler (focus_*, set_secret), 2) get_context from the
      // context provider, 3) built-in toast / unhandled fallback.
      let outcome = (await clientToolsRef.current?.(data)) ?? null;
      if (outcome == null && data.tool_id === "get_context") {
        outcome = {
          result: contextProviderRef.current?.() ?? {
            agent: agentSlug,
            client: "posthog-code",
          },
        };
      }
      if (outcome == null) outcome = handleClientTool(data, agentSlug);
      // Interactive tools (set_secret) post their own outcome later via
      // resolveInteractiveTool once the user submits the form.
      if (outcome.defer) return;
      try {
        await withPreviewToken((token) =>
          client.sendAgentClientToolResult(
            ingressBaseUrl,
            sessionId,
            data.call_id,
            outcome,
            token,
          ),
        );
      } catch {
        // Best-effort — the session will time the call out if this fails.
      }
    },
    [client, ingressBaseUrl, agentSlug, withPreviewToken],
  );

  const runStream = useCallback(
    async (sessionId: string) => {
      if (!ingressBaseUrl) return;
      // Supersede any in-flight stream (resume / new chat) and claim this epoch.
      abortRef.current?.abort();
      const epoch = ++epochRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      streamingRef.current = true;
      const store = agentChatStore.getState();
      // Pump the SSE generator with the supplied token. Returns:
      //   "remint"       — server signalled `preview_token_required` and is
      //                    closing the stream; mint fresh and reconnect.
      //   "auth_failure" — initial fetch 401'd; safety-net retry once.
      //   "done"         — natural exit (session ended, error surfaced, or
      //                    the run was superseded).
      const pump = async (
        token: string | null,
      ): Promise<"remint" | "auth_failure" | "done"> => {
        try {
          for await (const event of client.streamAgentSession(
            ingressBaseUrl,
            sessionId,
            controller.signal,
            token,
          )) {
            if (epochRef.current !== epoch) return "done";
            // Control event: don't surface to the user, just request a remint.
            if (event.kind === "preview_token_required") return "remint";
            store.appendMessages(chatId, mapperRef.current.apply(event));
            if (event.kind === "client_tool_call") {
              void dispatchClientTool(event.data, sessionId);
            } else if (event.kind === "completed") {
              store.setStatus(chatId, "completed");
            } else if (event.kind === "waiting") {
              store.setStatus(chatId, "awaiting_input");
            } else if (event.kind === "failed") {
              store.setStatus(chatId, "failed");
              store.setError(
                chatId,
                event.data?.reason ?? "The agent run failed.",
              );
            }
          }
          return "done";
        } catch (err) {
          if (
            revisionId &&
            !controller.signal.aborted &&
            isPreviewAuthError(err)
          ) {
            return "auth_failure";
          }
          if (epochRef.current === epoch && !controller.signal.aborted) {
            store.setError(
              chatId,
              err instanceof Error ? err.message : "Stream dropped.",
            );
          }
          return "done";
        }
      };
      try {
        let token = await getPreviewToken();
        // `preview_token_required` is unbounded (one re-mint per ~15 min TTL
        // on long author sessions); a true `[401]` only gets one retry as a
        // safety net for the initial fetch.
        let authRetried = false;
        while (true) {
          const outcome = await pump(token);
          if (epochRef.current !== epoch || controller.signal.aborted) break;
          if (outcome === "remint") {
            token = await getPreviewToken(true);
            continue;
          }
          if (outcome === "auth_failure" && !authRetried) {
            authRetried = true;
            token = await getPreviewToken(true);
            continue;
          }
          // outcome === "done", or auth_failure already retried → surface the
          // (already-set) error and exit.
          if (outcome === "auth_failure") {
            store.setError(
              chatId,
              "Preview session failed to authenticate. Try again.",
            );
          }
          break;
        }
      } catch (err) {
        // A `getPreviewToken` throw (initial mint or re-mint) lands here —
        // `pump` already handles its own errors. Without this the rejection
        // would slip past `finally` (which only flips status) and the user
        // would see the stream quietly stop.
        if (epochRef.current === epoch && !controller.signal.aborted) {
          store.setError(
            chatId,
            err instanceof Error ? err.message : "Preview session unavailable.",
          );
        }
      } finally {
        if (epochRef.current === epoch) {
          streamingRef.current = false;
          // Stream ended without a terminal frame mid-conversation → treat as
          // awaiting input so the composer stays usable.
          if (agentChatStore.getState().chats[chatId]?.status === "streaming") {
            agentChatStore.getState().setStatus(chatId, "awaiting_input");
          }
        }
      }
    },
    [
      client,
      ingressBaseUrl,
      chatId,
      dispatchClientTool,
      getPreviewToken,
      revisionId,
    ],
  );

  const start = useCallback(
    async (text: string) => {
      if (!ingressBaseUrl) return;
      mapperRef.current = createAgentChatMapper();
      const s = agentChatStore.getState();
      s.begin(chatId, agentSlug);
      // Render the user's clean message immediately; the stream's echo (which
      // includes the context envelope) is stripped + deduped by the mapper.
      s.appendMessages(chatId, mapperRef.current.seedUserMessage(text));
      const envelope = contextProviderRef.current?.();
      const wireText = envelope
        ? `${buildConsoleContextEnvelope(envelope)}\n\n${text}`
        : text;
      try {
        const { session_id } = await withPreviewToken((token) =>
          client.runAgentSession(ingressBaseUrl, wireText, token),
        );
        agentChatStore.getState().setSessionId(chatId, session_id);
        agentChatStore.getState().setStatus(chatId, "streaming");
        // Index this chat locally so it shows in the rail — only sessions the
        // user started here, never the agent's full (customer) session list.
        if (recordHistory) {
          recordChat(agentSlug, {
            sessionId: session_id,
            title: text.slice(0, 120),
            startedAt: Date.now(),
            revisionId: revisionId ?? undefined,
          });
        }
        void runStream(session_id);
      } catch (err) {
        agentChatStore.getState().setStatus(chatId, "failed");
        agentChatStore
          .getState()
          .setError(
            chatId,
            err instanceof Error ? err.message : "Couldn't start chat.",
          );
      }
    },
    [
      client,
      ingressBaseUrl,
      chatId,
      agentSlug,
      runStream,
      recordHistory,
      recordChat,
      revisionId,
      withPreviewToken,
    ],
  );

  const send = useCallback(
    async (text: string) => {
      const s = agentChatStore.getState();
      const sessionId = s.chats[chatId]?.sessionId;
      if (!ingressBaseUrl || !sessionId) return start(text);
      // Render the user's message immediately; the stream's echo is deduped.
      s.appendMessages(chatId, mapperRef.current.seedUserMessage(text));
      s.setStatus(chatId, "streaming");
      try {
        await withPreviewToken((token) =>
          client.sendAgentMessage(ingressBaseUrl, sessionId, text, token),
        );
        if (!streamingRef.current) void runStream(sessionId);
      } catch (err) {
        s.setStatus(chatId, "failed");
        s.setError(
          chatId,
          err instanceof Error ? err.message : "Couldn't send.",
        );
      }
    },
    [client, ingressBaseUrl, chatId, start, runStream, withPreviewToken],
  );

  const cancel = useCallback(async () => {
    const s = agentChatStore.getState();
    const sessionId = s.chats[chatId]?.sessionId;
    abortRef.current?.abort();
    s.setStatus(chatId, "cancelled");
    if (ingressBaseUrl && sessionId) {
      try {
        await withPreviewToken((token) =>
          client.cancelAgentSession(ingressBaseUrl, sessionId, token),
        );
      } catch {
        // Best-effort.
      }
    }
  }, [client, ingressBaseUrl, chatId, withPreviewToken]);

  // Resolve an interactive client tool (set_secret) once the user submits its
  // form: post the outcome via `/send` (which wakes the parked session) and
  // make sure the stream is attached to receive the resulting turn.
  const resolveInteractiveTool = useCallback(
    async (
      callId: string,
      outcome: { result: Record<string, unknown> } | { error: string },
    ) => {
      if (!ingressBaseUrl) return;
      const sessionId = agentChatStore.getState().chats[chatId]?.sessionId;
      if (!sessionId) return;
      agentChatStore.getState().setStatus(chatId, "streaming");
      try {
        await withPreviewToken((token) =>
          client.sendAgentInteractiveToolResult(
            ingressBaseUrl,
            sessionId,
            callId,
            outcome,
            token,
          ),
        );
        if (!streamingRef.current) void runStream(sessionId);
      } catch (err) {
        agentChatStore.getState().setStatus(chatId, "awaiting_input");
        agentChatStore
          .getState()
          .setError(
            chatId,
            err instanceof Error ? err.message : "Couldn't submit the secret.",
          );
      }
    },
    [client, ingressBaseUrl, chatId, runStream, withPreviewToken],
  );

  // Re-open a past preview chat. `/listen` only tails (it does not replay), so
  // history is rebuilt from the stored transcript; a still-active session then
  // attaches the live stream so the user can keep chatting where they left off.
  const resume = useCallback(
    async (sessionId: string) => {
      if (
        !ingressBaseUrl ||
        agentChatStore.getState().chats[chatId]?.sessionId === sessionId
      )
        return;
      abortRef.current?.abort();
      epochRef.current += 1;
      streamingRef.current = false;
      mapperRef.current = createAgentChatMapper();
      const s = agentChatStore.getState();
      s.begin(chatId, agentSlug);
      s.setSessionId(chatId, sessionId);
      s.setStatus(chatId, "starting");
      try {
        const detail = await client.getAgentApplicationSession(
          agentSlug,
          sessionId,
        );
        // A newer resume/new-chat won the race while we were fetching.
        if (agentChatStore.getState().chats[chatId]?.sessionId !== sessionId)
          return;
        const conversation = detail?.conversation ?? [];
        agentChatStore
          .getState()
          .appendMessages(chatId, conversationToAcpMessages(conversation));
        mapperRef.current.setPromptIdBase(
          conversation.filter((m) => m.role === "user").length,
        );
        if (!detail || TERMINAL_SESSION_STATES.has(detail.state)) {
          agentChatStore.getState().setStatus(chatId, "completed");
        } else {
          agentChatStore.getState().setStatus(chatId, "streaming");
          void runStream(sessionId);
        }
      } catch (err) {
        if (agentChatStore.getState().chats[chatId]?.sessionId !== sessionId)
          return;
        agentChatStore.getState().setStatus(chatId, "failed");
        agentChatStore
          .getState()
          .setError(
            chatId,
            err instanceof Error ? err.message : "Couldn't load this chat.",
          );
      }
    },
    [client, ingressBaseUrl, chatId, agentSlug, runStream],
  );

  // Clear the surface for a brand-new chat; the next send starts a new session.
  const newChat = useCallback(() => {
    abortRef.current?.abort();
    epochRef.current += 1;
    streamingRef.current = false;
    mapperRef.current = createAgentChatMapper();
    agentChatStore.getState().reset(chatId);
  }, [chatId]);

  // Abort the stream when the consumer unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    messages: chat?.messages ?? [],
    status: chat?.status ?? "idle",
    error: chat?.error ?? null,
    isStreaming: chat?.status === "streaming" || chat?.status === "starting",
    hasSession: !!chat?.sessionId,
    sessionId: chat?.sessionId ?? null,
    send,
    cancel,
    resume,
    newChat,
    resolveInteractiveTool,
  };
}

/** Resolve a client-tool call. Immediate tools only; the rest degrade. */
function handleClientTool(
  data: Extract<AgentSessionEvent, { kind: "client_tool_call" }>["data"],
  agentSlug: string,
): { result?: unknown; error?: string } {
  switch (data.tool_id) {
    case "toast": {
      const args = (data.args ?? {}) as { message?: string; level?: string };
      const message = args.message ?? "";
      if (args.level === "error") toast.error(message);
      else if (args.level === "warn") toast.warning(message);
      else toast.info(message);
      return { result: { shown: true } };
    }
    case "get_context":
      return { result: { agent: agentSlug, client: "posthog-code" } };
    default:
      // focus_*, set_secret, … land with the agent builder milestone.
      return { error: `unhandled_client_tool: ${data.tool_id}` };
  }
}
