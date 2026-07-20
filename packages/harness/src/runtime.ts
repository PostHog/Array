import { join } from "node:path";
import type {
  AgentSessionRuntime,
  CreateAgentSessionFromServicesOptions,
  CreateAgentSessionRuntimeFactory,
  CreateAgentSessionServicesOptions,
} from "@earendil-works/pi-coding-agent";
import { installHogBrandEnv } from "./extensions/hog-branding/brand-env";
import type { HarnessExtensionOptions } from "./extensions/registry";

type PiRuntimeTarget = Parameters<CreateAgentSessionRuntimeFactory>[0];

export type HarnessRuntimeOptions = HarnessExtensionOptions &
  Partial<
    Pick<
      PiRuntimeTarget,
      "cwd" | "agentDir" | "sessionManager" | "sessionStartEvent"
    >
  > &
  Omit<CreateAgentSessionServicesOptions, "cwd" | "agentDir"> &
  Omit<
    CreateAgentSessionFromServicesOptions,
    "services" | "sessionManager" | "sessionStartEvent"
  >;

/**
 * Build the standard PostHog distribution of Pi.
 *
 * The returned value is Pi's native `AgentSessionRuntime`, so it can be
 * passed directly to `runRpcMode`, `runPrintMode`, or `InteractiveMode`, or
 * used in-process through `runtime.session`. The same factory is retained by
 * Pi and recreates all cwd-bound services and harness extensions when a
 * session is replaced, forked, or imported.
 */
export async function createHarnessRuntime(
  options: HarnessRuntimeOptions = {},
): Promise<AgentSessionRuntime> {
  // Pi reads its application branding when the SDK is first evaluated. Keep
  // every runtime import below dynamic so this always happens first.
  installHogBrandEnv();

  const pi = await import("@earendil-works/pi-coding-agent");
  const [{ harnessExtensions }, { DEFAULT_MODEL }] = await Promise.all([
    import("./extensions/registry"),
    import("./extensions/posthog-provider/models"),
  ]);

  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? pi.getAgentDir();

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd: runtimeCwd,
    agentDir: runtimeAgentDir,
    sessionManager,
    sessionStartEvent,
  }) => {
    const authStorage =
      options.authStorage ??
      pi.AuthStorage.create(join(runtimeAgentDir, "auth.json"));

    const services = await pi.createAgentSessionServices({
      ...options,
      cwd: runtimeCwd,
      agentDir: runtimeAgentDir,
      authStorage,
      settingsManager:
        options.settingsManager ??
        pi.SettingsManager.create(runtimeCwd, runtimeAgentDir, {
          projectTrusted: false,
        }),
      resourceLoaderOptions: {
        ...options.resourceLoaderOptions,
        extensionFactories: [
          ...(options.resourceLoaderOptions?.extensionFactories ?? []),
          ...harnessExtensions(options),
        ],
      },
    });

    const preferredModel = services.modelRegistry.find(
      "posthog",
      DEFAULT_MODEL,
    );
    const fallbackModel = services.modelRegistry
      .getAll()
      .find((model) => model.provider === "posthog");

    const created = await pi.createAgentSessionFromServices({
      ...options,
      services,
      sessionManager,
      sessionStartEvent,
      model: options.model ?? preferredModel ?? fallbackModel,
    });

    return {
      ...created,
      services,
      diagnostics: [
        ...services.diagnostics,
        ...services.resourceLoader
          .getExtensions()
          .errors.map(({ path, error }) => ({
            type: "error" as const,
            message: `Failed to load extension "${path}": ${error}`,
          })),
      ],
    };
  };

  const sessionManager =
    options.sessionManager ?? pi.SessionManager.create(cwd);

  return pi.createAgentSessionRuntime(createRuntime, {
    cwd: sessionManager.getCwd(),
    agentDir,
    sessionManager,
    sessionStartEvent: options.sessionStartEvent,
  });
}
