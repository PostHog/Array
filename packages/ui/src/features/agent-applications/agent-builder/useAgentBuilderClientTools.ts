import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef } from "react";
import type { ClientToolHandler } from "../hooks/useAgentChat";
import { useAgentBuilderStore } from "./agentBuilderStore";

/**
 * The `kind:'client'` tool ids the agent-builder dock can fulfil — sent to the
 * runner as `supported_client_tools` at /run so it exposes only these to the
 * model. Keep in sync with the handlers below (plus the built-in
 * toast/get_context). `set_secret`/`connect_mcp` are interactive punch-outs.
 */
export const AGENT_BUILDER_CLIENT_TOOLS = [
  "set_secret",
  "connect_mcp",
  "focus_tab",
  "focus_file",
  "focus_spec_section",
  "focus_revision",
  "focus_session",
  "toast",
  "get_context",
] as const;

/**
 * The agent builder's UI-driving client tools. The agent calls these to steer the
 * user's screen (`focus_*`, which navigate code's agent routes and report back
 * `{ focused }`) and to set secrets (`set_secret`, an interactive punch-out:
 * park the call and render a form — see the dock). Returning `null` defers to
 * the built-in toast/get_context handlers.
 *
 * `focus_*` navigations are gated by follow-mode: when off, they report
 * `{ focused: false, reason: "user_paused_follow" }` instead of moving the UI.
 */
export function useAgentBuilderClientTools(): ClientToolHandler {
  const navigate = useNavigate();
  const followMode = useAgentBuilderStore((s) => s.followMode);
  const setPendingSecret = useAgentBuilderStore((s) => s.setPendingSecret);
  const setPendingMcpConnect = useAgentBuilderStore(
    (s) => s.setPendingMcpConnect,
  );
  const page = useAgentBuilderStore((s) => s.page);
  const followRef = useRef(followMode);
  followRef.current = followMode;
  // Latest page context without re-creating the handler each render — resolves
  // the revision a `set_secret` punch-out targets when the agent omits one.
  const pageRef = useRef(page);
  pageRef.current = page;

  return useCallback(
    (data) => {
      const args = (data.args ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" ? v : undefined);

      // set_secret — interactive punch-out. Park the call (defer) and render a
      // form; the dock PUTs the key and wakes the session on submit. Env keys
      // are revision-scoped, so resolve the target revision from the tool args,
      // falling back to the revision the user is currently viewing in the
      // agent-config page.
      if (data.tool_id === "set_secret") {
        const agentSlug = str(args.agent_slug);
        const secret = str(args.secret);
        if (!agentSlug) return { error: "missing_arg: agent_slug" };
        if (!secret) return { error: "missing_arg: secret" };
        const p = pageRef.current;
        const pageRevision = p.kind === "agent-config" ? p.revision : undefined;
        const revisionId = str(args.revision_id) ?? pageRevision;
        if (!revisionId) return { error: "missing_arg: revision_id" };
        const mode = args.mode === "rotate" ? "rotate" : "set";
        setPendingSecret({
          callId: data.call_id,
          agentSlug,
          revisionId,
          secret,
          mode,
          purpose: str(args.purpose),
        });
        return { defer: true };
      }

      // connect_mcp — interactive punch-out. Park the call and render a prefilled
      // connect form; the dock runs the native OAuth/api-key connect (auth never
      // touches the agent), writes the resulting mcps[].connection onto the
      // target agent's spec, and wakes the session. Like set_secret, the target
      // revision comes from the args or the current agent-config page.
      if (data.tool_id === "connect_mcp") {
        const agentSlug = str(args.agent_slug);
        if (!agentSlug) return { error: "missing_arg: agent_slug" };
        const p = pageRef.current;
        const pageRevision = p.kind === "agent-config" ? p.revision : undefined;
        const revisionId = str(args.revision_id) ?? pageRevision;
        if (!revisionId) return { error: "missing_arg: revision_id" };
        setPendingMcpConnect({
          callId: data.call_id,
          agentSlug,
          revisionId,
          name: str(args.name),
          url: str(args.url),
          purpose: str(args.purpose),
        });
        return { defer: true };
      }

      if (!data.tool_id.startsWith("focus_")) return null;
      const slug = str(args.slug);
      if (!followRef.current) {
        return { result: { focused: false, reason: "user_paused_follow" } };
      }
      if (!slug) {
        return { result: { focused: false, reason: "missing_slug" } };
      }
      const params = { idOrSlug: slug };

      switch (data.tool_id) {
        case "focus_tab": {
          const tab = str(args.tab) ?? "overview";
          switch (tab) {
            case "configuration":
              navigate({
                to: "/code/agents/applications/$idOrSlug/configuration",
                params,
              });
              break;
            case "sessions":
              navigate({
                to: "/code/agents/applications/$idOrSlug/sessions",
                params,
              });
              break;
            case "memory":
              navigate({
                to: "/code/agents/applications/$idOrSlug/memory",
                params,
              });
              break;
            case "approvals":
              navigate({
                to: "/code/agents/applications/$idOrSlug/approvals",
                params,
              });
              break;
            case "observability":
              navigate({
                to: "/code/agents/applications/$idOrSlug/observability",
                params,
              });
              break;
            case "chat":
              navigate({
                to: "/code/agents/applications/$idOrSlug/chat",
                params,
              });
              break;
            default:
              navigate({
                to: "/code/agents/applications/$idOrSlug",
                params,
              });
          }
          return { result: { focused: true } };
        }
        case "focus_file":
          navigate({
            to: "/code/agents/applications/$idOrSlug/configuration",
            params,
            search: { node: str(args.path) },
          });
          return { result: { focused: true } };
        case "focus_spec_section":
          navigate({
            to: "/code/agents/applications/$idOrSlug/configuration",
            params,
            search: { node: str(args.section) },
          });
          return { result: { focused: true } };
        case "focus_revision":
          navigate({
            to: "/code/agents/applications/$idOrSlug/configuration",
            params,
            search: { revision: str(args.revisionId) },
          });
          return { result: { focused: true } };
        case "focus_session": {
          const sessionId = str(args.sessionId);
          if (!sessionId) {
            return { result: { focused: false, reason: "missing_session_id" } };
          }
          navigate({
            to: "/code/agents/applications/$idOrSlug/sessions/$sessionId",
            params: { idOrSlug: slug, sessionId },
          });
          return { result: { focused: true } };
        }
        default:
          return { result: { focused: false, reason: "unknown_focus_target" } };
      }
    },
    [navigate, setPendingSecret, setPendingMcpConnect],
  );
}
