import {
  type AgentSession,
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
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
