import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "local-tools-mcp-server-"));
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

describe("local-tools MCP server", () => {
  it("starts the bundled server and executes an enabled tool", async () => {
    const cwd = await temporaryDirectory();
    const client = new Client({ name: "local-tools-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        join(process.cwd(), "../../node_modules/tsx/dist/cli.mjs"),
        join(process.cwd(), "src/adapters/local-tools/mcp-server.ts"),
      ],
      cwd,
      env: {
        PATH: process.env.PATH ?? "",
        POSTHOG_LOCAL_TOOLS_CTX: Buffer.from(
          JSON.stringify({ cwd, taskId: "task-1", taskRunId: "run-1" }),
        ).toString("base64"),
        POSTHOG_LOCAL_TOOLS_ENABLED: "speak",
      },
    });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const result = await client.callTool({
        name: "speak",
        arguments: { text: "Completed the task", kind: "done" },
      });

      expect(tools.tools.map((tool) => tool.name)).toEqual(["speak"]);
      expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    } finally {
      await client.close();
    }
  });
});
