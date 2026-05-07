/**
 * Standalone stdio MCP server for structured output in the Codex adapter.
 *
 * Spawned by codex-acp as an MCP server process. Reads the JSON schema
 * from the POSTHOG_OUTPUT_SCHEMA env var (base64-encoded) and registers
 * a tool whose Zod shape McpServer.tool() validates on each call.
 *
 * Usage:
 *   POSTHOG_OUTPUT_SCHEMA=<base64> node structured-output-mcp-server.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  STRUCTURED_OUTPUT_MCP_NAME,
  STRUCTURED_OUTPUT_TOOL_NAME,
} from "./structured-output-constants";

function die(message: string): never {
  process.stderr.write(`[structured-output-mcp-server] ${message}\n`);
  process.exit(1);
}

const schemaEnv = process.env.POSTHOG_OUTPUT_SCHEMA;
if (!schemaEnv) {
  die("POSTHOG_OUTPUT_SCHEMA env var is required");
}

let jsonSchema: Record<string, unknown>;
try {
  jsonSchema = JSON.parse(Buffer.from(schemaEnv, "base64").toString("utf-8"));
} catch (err) {
  die(`Failed to parse POSTHOG_OUTPUT_SCHEMA as base64-encoded JSON: ${err}`);
}

const zodType = z.fromJSONSchema(jsonSchema);
if (!(zodType instanceof z.ZodObject)) {
  die(
    `POSTHOG_OUTPUT_SCHEMA must describe a JSON object schema (got ${zodType.constructor.name})`,
  );
}
// McpServer.tool() expects a mutable ZodRawShape
const zodShape = { ...zodType.shape } as z.ZodRawShape;

const server = new McpServer({
  name: STRUCTURED_OUTPUT_MCP_NAME,
  version: "1.0.0",
});

server.tool(
  STRUCTURED_OUTPUT_TOOL_NAME,
  "Submit the structured output for this task. Call this tool with the required fields to deliver your final result.",
  zodShape,
  async () => {
    // McpServer.tool() validates `args` against `zodShape` before invoking
    // this handler, so reaching this point means the input is valid. The
    // parent process captures the validated output by intercepting the
    // tool call in the ACP stream.
    return {
      content: [
        {
          type: "text" as const,
          text: "Output submitted successfully.",
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
