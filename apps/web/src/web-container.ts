import "reflect-metadata";
import { TypedContainer } from "@inversifyjs/strongly-typed";
import { setRootContainer } from "@posthog/di/container";
import { ROOT_LOGGER, type RootLogger } from "@posthog/di/logger";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import { sandboxProxyHtml } from "@posthog/shared/mcp-sandbox-proxy";
import {
  AUTH_SIDE_EFFECTS,
  type IAuthSideEffects,
} from "@posthog/ui/features/auth/identifiers";
import {
  FEATURE_FLAGS,
  type FeatureFlags,
} from "@posthog/ui/features/feature-flags/identifiers";
import { McpAppHost } from "@posthog/ui/features/mcp-apps/components/McpAppHost";
import {
  MCP_APP_HOST_COMPONENT,
  MCP_SANDBOX_PROXY_URL,
  type McpAppHostComponent,
  type McpSandboxProxyUrlProvider,
} from "@posthog/ui/features/mcp-apps/identifiers";
import {
  ANALYTICS_TRACKER,
  type AnalyticsTracker,
} from "@posthog/ui/shell/analytics";
import {
  IMPERATIVE_QUERY_CLIENT,
  type ImperativeQueryClient,
} from "@posthog/ui/shell/queryClient";
import { QueryClient } from "@tanstack/react-query";
import { WebAuthSideEffects } from "./web-auth-side-effects";
import { hostTrpcClient } from "./web-trpc";

interface WebBindings {
  [HOST_TRPC_CLIENT]: HostTrpcClient;
  [ROOT_LOGGER]: RootLogger;
  [FEATURE_FLAGS]: FeatureFlags;
  [ANALYTICS_TRACKER]: AnalyticsTracker;
  [IMPERATIVE_QUERY_CLIENT]: ImperativeQueryClient;
  [AUTH_SIDE_EFFECTS]: IAuthSideEffects;
  [MCP_APP_HOST_COMPONENT]: McpAppHostComponent;
  [MCP_SANDBOX_PROXY_URL]: McpSandboxProxyUrlProvider;
}

export const queryClient = new QueryClient();

export const container = new TypedContainer<WebBindings>({
  defaultScope: "Singleton",
});

// Keystone: the same typed host client the renderer binds, over HTTP not IPC.
container.bind(HOST_TRPC_CLIENT).toConstantValue(hostTrpcClient);

// Logger: web uses console; electron uses electron-log. Same RootLogger shape.
const scoped = (name?: string): RootLogger => ({
  debug: (...a) => console.debug(name ? `[${name}]` : "", ...a),
  info: (...a) => console.info(name ? `[${name}]` : "", ...a),
  warn: (...a) => console.warn(name ? `[${name}]` : "", ...a),
  error: (...a) => console.error(name ? `[${name}]` : "", ...a),
  scope: (n: string) => scoped(n),
});
container.bind(ROOT_LOGGER).toConstantValue(scoped());

// ── Stubbed web ports (TODO: real web adapters — posthog-js, localStorage, etc.) ──
container.bind(FEATURE_FLAGS).toConstantValue({
  isEnabled: () => false,
  onFlagsLoaded: () => () => {},
});
container.bind(ANALYTICS_TRACKER).toConstantValue({
  track: () => {},
  setActiveTaskContext: () => {},
  captureException: () => {},
  identifyUser: () => {},
  setUserGroups: () => {},
  resetUser: () => {},
  captureSurveyResponse: () => {},
});
container.bind(IMPERATIVE_QUERY_CLIENT).toConstantValue(queryClient);

// Interactive MCP App iframe host. Electron isolates the proxy with a custom
// privileged scheme; web gets a separate origin for free via a blob URL of the
// same (host-agnostic) proxy HTML. The blob is created once, lazily.
container.bind(AUTH_SIDE_EFFECTS).to(WebAuthSideEffects);

container.bind(MCP_APP_HOST_COMPONENT).toConstantValue(McpAppHost);
let sandboxProxyUrl: string | null = null;
container.bind(MCP_SANDBOX_PROXY_URL).toConstantValue(() => {
  if (!sandboxProxyUrl) {
    sandboxProxyUrl = URL.createObjectURL(
      new Blob([sandboxProxyHtml], { type: "text/html" }),
    );
  }
  return sandboxProxyUrl;
});

setRootContainer(container);
