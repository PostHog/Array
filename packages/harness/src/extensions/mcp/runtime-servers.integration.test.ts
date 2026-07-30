import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
} from "@earendil-works/pi-ai/compat";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  type ExtensionAPI,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "./config";
import { createMcpExtension } from "./extension";
import { createMockMcpServer } from "./test-support";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mcp-runtime-server-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("runtime MCP servers", () => {
  it("lets a Pi session call a first-party runtime tool", async () => {
    const cwd = await temporaryDirectory();
    const agentDir = await temporaryDirectory();
    const called = vi.fn();
    const mcpServer = createMockMcpServer([
      {
        name: "echo",
        description: "Echo text back",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        handler: (args) => {
          called(args);
          return { content: [{ type: "text", text: `echo: ${args.text}` }] };
        },
      },
    ]);
    const faux = registerFauxProvider();
    const model = faux.getModel();
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("mcp_posthog_code_tools_echo", {
            text: "hello",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("finished"),
    ]);

    const credentials = new InMemoryCredentialStore();
    await credentials.modify(model.provider, async () => ({
      type: "api_key",
      key: "faux-key",
    }));
    const modelRuntime = await ModelRuntime.create({ credentials });
    const services = await createAgentSessionServices({
      agentDir,
      modelRuntime,
      cwd,
      resourceLoaderOptions: {
        extensionFactories: [
          {
            name: "faux-provider",
            factory(pi: ExtensionAPI) {
              pi.registerProvider(model.provider, {
                baseUrl: model.baseUrl,
                apiKey: "faux-key",
                api: faux.api,
                models: faux.models,
              });
            },
          },
          {
            name: "mcp",
            factory: createMcpExtension({
              configLoader: async () => parseConfig({}, "test"),
              runtimeServers: {
                "posthog-code-tools": {
                  command: "node",
                  args: ["local-tools.js"],
                  lifecycle: "eager",
                  directTools: true,
                },
              },
              transportFactory: mcpServer.transportFactory,
            }),
          },
        ],
        noPromptTemplates: true,
        noSkills: true,
        noThemes: true,
      },
    });
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(cwd),
      model,
    });

    try {
      await session.bindExtensions({});
      await session.prompt("Call the first-party echo tool");

      expect(called).toHaveBeenCalledWith({ text: "hello" });
      expect(faux.state.callCount).toBe(2);
    } finally {
      session.dispose();
      faux.unregister();
      await mcpServer.close();
    }
  });
});
