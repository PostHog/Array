import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { installHogBrandEnv } from "./extensions/hog-branding/brand-env";
import { DEFAULT_MODEL } from "./extensions/posthog-provider/models";
import {
  POSTHOG_PROVIDER_NAME,
  type PosthogProviderOptions,
  resolvePosthogProvider,
} from "./extensions/posthog-provider/provider";

export interface HarnessSessionOptions extends PosthogProviderOptions {
  cwd?: string;
  model?: string;
}

export async function createHarnessSession(
  options: HarnessSessionOptions = {},
): Promise<AgentSession> {
  // Must finish running before `@earendil-works/pi-coding-agent` is
  // evaluated, so pi picks up "hog" branding when its config module first
  // evaluates. Hence the dynamic import right below, rather than a static
  // top-level one — see `./extensions/hog-branding/brand-env` for why a
  // static import wouldn't reliably run first once bundled.
  installHogBrandEnv();
  const {
    AuthStorage,
    createAgentSession,
    DefaultResourceLoader,
    getAgentDir,
    ModelRegistry,
  } = await import("@earendil-works/pi-coding-agent");

  const cwd = options.cwd ?? process.cwd();

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  modelRegistry.registerProvider(
    POSTHOG_PROVIDER_NAME,
    await resolvePosthogProvider(options),
  );

  const model = modelRegistry.find(
    POSTHOG_PROVIDER_NAME,
    options.model ?? DEFAULT_MODEL,
  );

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    // The bundled MCP extension owns long-lived server processes and
    // interactive OAuth flows, so it is only loaded by the CLI/TUI extension
    // registry and not by embedded SDK sessions.
    extensionFactories: [],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    authStorage,
    modelRegistry,
    resourceLoader,
    cwd,
    ...(model ? { model } : {}),
  });

  return session;
}
