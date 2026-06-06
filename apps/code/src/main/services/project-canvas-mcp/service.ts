import { randomUUID } from "node:crypto";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { inject, injectable, preDestroy } from "inversify";
import { z } from "zod";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { WorkProjectsService } from "../work-projects/service";

const log = logger.scope("project-canvas-mcp");

const MCP_SERVER_NAME = "projectCanvas";

const PROJECT_ICON_IDS = [
  "rocket",
  "microphone",
  "megaphone",
  "lightbulb",
  "compass",
  "target",
  "flask",
] as const;

const NOTE_TONES = ["yellow", "blue", "green", "pink", "neutral"] as const;

/**
 * In-process MCP server exposed on a local loopback HTTP port using the
 * Streamable HTTP transport. Gives the Claude Code agent subprocess a set of
 * tools to mutate a PostHog Code project canvas — propose tiles, rename the
 * project, set next-step suggestions.
 *
 * Uses STATEFUL mode (per-session transport, sessions tracked by
 * `Mcp-Session-Id` header) which is the canonical pattern that works with
 * stock MCP HTTP clients. Each project chat session gets its own transport
 * after the initial handshake; the server (and registered tools) are
 * shared globally.
 */
@injectable()
export class ProjectCanvasMcpService {
  private httpServer: http.Server | null = null;
  private port: number | null = null;
  private startPromise: Promise<void> | null = null;
  private mcpServer: McpServer | null = null;
  private transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(
    @inject(MAIN_TOKENS.WorkProjectsService)
    private readonly workProjects: WorkProjectsService,
  ) {}

  async start(): Promise<void> {
    if (this.httpServer && this.port) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.doStart().catch((err) => {
      this.startPromise = null;
      throw err;
    });
    return this.startPromise;
  }

  /** Returns the loopback URL the agent should hit. Starts lazily. */
  async getUrl(): Promise<string> {
    await this.start();
    if (!this.port) throw new Error("Project canvas MCP not started");
    const url = `http://127.0.0.1:${this.port}/mcp`;
    log.info("Returning canvas MCP URL", { url });
    return url;
  }

  private async doStart(): Promise<void> {
    this.mcpServer = new McpServer({
      name: MCP_SERVER_NAME,
      version: "1.0.0",
    });
    this.registerTools(this.mcpServer);

    const httpServer = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res).catch((err) => {
        log.error("Unhandled MCP HTTP error", { err });
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null,
            }),
          );
        }
      });
    });
    this.httpServer = httpServer;

    await new Promise<void>((resolve, reject) => {
      httpServer.listen(0, "127.0.0.1", () => {
        const addr = httpServer.address();
        if (typeof addr === "object" && addr) {
          this.port = addr.port;
          log.info("Project canvas MCP listening", { port: this.port });
          resolve();
        } else {
          reject(new Error("Failed to get MCP server address"));
        }
      });
      httpServer.on("error", (err) => {
        log.error("Project canvas MCP server error", { err });
        reject(err);
      });
    });
  }

  private async readBody(req: http.IncomingMessage): Promise<unknown> {
    if (req.method !== "POST") return undefined;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    if (chunks.length === 0) return undefined;
    const text = Buffer.concat(chunks).toString("utf-8");
    try {
      return JSON.parse(text);
    } catch (err) {
      log.warn("Invalid JSON body", { err, snippet: text.slice(0, 200) });
      return undefined;
    }
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const sessionId =
      (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
    const body = await this.readBody(req);

    log.debug("Canvas MCP request", {
      method: req.method,
      url: req.url,
      sessionId: sessionId ?? "(none)",
      bodyMethod:
        body && typeof body === "object" && "method" in body
          ? (body as { method: string }).method
          : undefined,
    });

    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && this.transports.has(sessionId)) {
      transport = this.transports.get(sessionId);
    } else if (!sessionId && body && isInitializeRequest(body)) {
      // New session — create a transport and connect it to the shared server.
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          if (transport) {
            this.transports.set(id, transport);
            log.info("Canvas MCP session initialized", { sessionId: id });
          }
        },
        onsessionclosed: (id) => {
          this.transports.delete(id);
          log.info("Canvas MCP session closed", { sessionId: id });
        },
      });
      if (this.mcpServer) {
        await this.mcpServer.connect(transport);
      }
    } else {
      log.warn("Canvas MCP request with no valid session", {
        method: req.method,
        sessionId: sessionId ?? "(none)",
        hasBody: body !== undefined,
      });
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        }),
      );
      return;
    }

    if (!transport) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "No transport available" },
          id: null,
        }),
      );
      return;
    }

    await transport.handleRequest(req, res, body);
  }

  private registerTools(server: McpServer): void {
    const projectIdField = z
      .string()
      .describe("The id of the project whose canvas to mutate.");

    server.tool(
      "propose_tile_headline",
      "Propose a big-metric headline tile on the project canvas. Use for top-line numbers like signup conversion %, weekly active users, error rate. Arrives as a ghost tile the user reviews before it's accepted.",
      {
        projectId: projectIdField,
        label: z
          .string()
          .describe("Short metric label, e.g. 'Signup conversion'."),
        fallbackValue: z
          .string()
          .describe("Displayed value, e.g. '23%' or '1,420'."),
        fallbackDelta: z
          .string()
          .describe(
            "Short delta vs prior period, e.g. '-4pt WoW' or '+12% MoM'.",
          ),
        fallbackSparkline: z
          .array(z.number())
          .min(2)
          .max(30)
          .describe("Small numeric series for the sparkline."),
        posthogUrl: z
          .string()
          .url()
          .optional()
          .describe(
            "Optional PostHog dashboard/insight URL the metric came from.",
          ),
      },
      async (args) => {
        log.info("Tool call: propose_tile_headline", {
          projectId: args.projectId,
          label: args.label,
        });
        const updated = this.workProjects.addTile(
          args.projectId,
          {
            type: "headline",
            label: args.label,
            fallbackValue: args.fallbackValue,
            fallbackDelta: args.fallbackDelta,
            fallbackSparkline: args.fallbackSparkline,
            ...(args.posthogUrl ? { posthogUrl: args.posthogUrl } : {}),
          },
          { state: "pending_add", origin: "chat" },
        );
        return toolText(
          updated
            ? `Headline tile proposed on project ${args.projectId}.`
            : `Project ${args.projectId} not found.`,
        );
      },
    );

    server.tool(
      "propose_tile_insight",
      "Propose an insight tile linking to a PostHog dashboard or insight. Use when you want to point the user at a real PostHog artifact they can open and explore. Arrives as a ghost tile.",
      {
        projectId: projectIdField,
        title: z.string().describe("Tile title, ≤60 chars."),
        description: z
          .string()
          .optional()
          .describe("Optional one-line description."),
        url: z
          .string()
          .url()
          .describe("Full PostHog URL to the insight or dashboard."),
        posthogProjectId: z
          .number()
          .describe(
            "The numeric PostHog project id this insight belongs to (NOT the project canvas id).",
          ),
        dashboardId: z.number().optional(),
        insightId: z.number().optional(),
        shortId: z.string().optional(),
      },
      async (args) => {
        log.info("Tool call: propose_tile_insight", {
          projectId: args.projectId,
          title: args.title,
        });
        const updated = this.workProjects.addTile(
          args.projectId,
          {
            type: "insight",
            title: args.title,
            url: args.url,
            posthogProjectId: args.posthogProjectId,
            ...(args.description ? { description: args.description } : {}),
            ...(args.dashboardId !== undefined
              ? { dashboardId: args.dashboardId }
              : {}),
            ...(args.insightId !== undefined
              ? { insightId: args.insightId }
              : {}),
            ...(args.shortId ? { shortId: args.shortId } : {}),
          },
          { state: "pending_add", origin: "chat" },
        );
        return toolText(
          updated
            ? `Insight tile proposed on project ${args.projectId}.`
            : `Project ${args.projectId} not found.`,
        );
      },
    );

    server.tool(
      "propose_tile_note",
      "Propose a sticky-note tile. Renders markdown so it's the right place for written findings, hypothesis lists, callouts, open questions, or annotations.",
      {
        projectId: projectIdField,
        body: z
          .string()
          .max(4000)
          .describe(
            "Note body in markdown. Headings, bullets, checklists, and links are all rendered.",
          ),
        tone: z.enum(NOTE_TONES).optional().describe("Sticky-note color tone."),
      },
      async (args) => {
        log.info("Tool call: propose_tile_note", {
          projectId: args.projectId,
        });
        const updated = this.workProjects.addTile(
          args.projectId,
          {
            type: "note",
            body: args.body,
            tone: args.tone ?? "yellow",
          },
          { state: "pending_add", origin: "chat" },
        );
        return toolText(
          updated
            ? `Note tile proposed on project ${args.projectId}.`
            : `Project ${args.projectId} not found.`,
        );
      },
    );

    server.tool(
      "propose_tile_artifact",
      `Propose a rich "artifact" tile on the canvas — checklist, table, chart, code, or embed. ONE tile type, multiple kinds. Use this when none of propose_tile_{headline,insight,note} fit. Pass the right shape in \`data\` for the chosen \`kind\`:

- kind="checklist": data = { items: [{ text: string, done: boolean }, ...] }
- kind="table":     data = { headers: string[], rows: string[][] }
- kind="chart":     data = { chartKind: "bar" | "line", series: [{ label: string, value: number }, ...], unit?: string }
- kind="code":      data = { language: string, body: string }
- kind="embed":     data = { url: string, description?: string }

Arrives as a ghost tile the user reviews before it's accepted.`,
      {
        projectId: projectIdField,
        kind: z
          .enum(["checklist", "table", "chart", "code", "embed"])
          .describe("Artifact renderer to dispatch to."),
        title: z.string().max(80).describe("Tile title shown in the header."),
        data: z
          .record(z.string(), z.unknown())
          .describe(
            "Per-kind payload. See the tool description for the shape of each kind.",
          ),
      },
      async (args) => {
        log.info("Tool call: propose_tile_artifact", {
          projectId: args.projectId,
          kind: args.kind,
          title: args.title,
        });
        const updated = this.workProjects.addTile(
          args.projectId,
          {
            type: "artifact",
            kind: args.kind,
            title: args.title,
            data: args.data,
          },
          { state: "pending_add", origin: "chat" },
        );
        return toolText(
          updated
            ? `Artifact tile (${args.kind}) proposed on project ${args.projectId}.`
            : `Project ${args.projectId} not found.`,
        );
      },
    );

    server.tool(
      "update_project_meta",
      "Rename the project, update its tagline, or change its icon. Use sparingly — only when the project should clearly be called something different than its current name.",
      {
        projectId: projectIdField,
        name: z.string().max(48).optional(),
        tagline: z.string().max(80).optional(),
        iconId: z.enum(PROJECT_ICON_IDS).optional(),
      },
      async (args) => {
        log.info("Tool call: update_project_meta", {
          projectId: args.projectId,
          name: args.name,
        });
        const updated = this.workProjects.updateTitleTile(args.projectId, {
          name: args.name,
          tagline: args.tagline,
          iconId: args.iconId,
        });
        return toolText(
          updated
            ? `Project ${args.projectId} meta updated.`
            : `Project ${args.projectId} not found or no change.`,
        );
      },
    );

    server.tool(
      "get_current_canvas",
      "Read the live state of the project canvas right now — including any tiles the user has accepted, rejected, edited, or removed since the conversation started. Use this whenever you want fresh ground truth before proposing changes or claiming what's on the canvas.",
      {
        projectId: projectIdField,
      },
      async (args) => {
        log.info("Tool call: get_current_canvas", {
          projectId: args.projectId,
        });
        const project = this.workProjects.get(args.projectId);
        if (!project) {
          return toolText(`Project ${args.projectId} not found.`);
        }
        const snapshot = {
          id: project.id,
          name: project.name,
          tagline: project.tagline,
          iconId: project.iconId,
          pinned: !!project.pinnedAt,
          nextSteps: project.nextSteps ?? [],
          tiles: project.tiles.map((t) => {
            const base = { id: t.id, type: t.type, state: t.state };
            if (t.type === "title") {
              return { ...base, name: t.name, tagline: t.tagline };
            }
            if (t.type === "headline") {
              return {
                ...base,
                label: t.label,
                value: t.fallbackValue,
                delta: t.fallbackDelta,
                ...(t.posthogUrl ? { posthogUrl: t.posthogUrl } : {}),
              };
            }
            if (t.type === "insight") {
              return {
                ...base,
                title: t.title,
                description: t.description,
                url: t.url,
              };
            }
            if (t.type === "file") {
              return {
                ...base,
                title: t.title,
                items: t.items.map((i) => i.path),
              };
            }
            if (t.type === "note") {
              return { ...base, body: t.body, tone: t.tone };
            }
            return base;
          }),
        };
        return toolText(JSON.stringify(snapshot, null, 2));
      },
    );

    server.tool(
      "set_next_steps",
      "Set the 2–3 suggested next-step prompts shown below the chat as clickable chips. Call this at the END of every turn. Each prompt should be short and imperative (≤80 chars), e.g. 'Segment funnel by traffic source'.",
      {
        projectId: projectIdField,
        prompts: z
          .array(z.string().min(1).max(120))
          .min(1)
          .max(3)
          .describe("2–3 short next-step prompts."),
      },
      async (args) => {
        log.info("Tool call: set_next_steps", {
          projectId: args.projectId,
          count: args.prompts.length,
        });
        const updated = this.workProjects.setNextSteps(
          args.projectId,
          args.prompts,
        );
        return toolText(
          updated
            ? `Next-steps set on project ${args.projectId}.`
            : `Project ${args.projectId} not found.`,
        );
      },
    );
  }

  @preDestroy()
  async stop(): Promise<void> {
    for (const transport of this.transports.values()) {
      try {
        await transport.close();
      } catch (err) {
        log.warn("Failed to close MCP transport", { err });
      }
    }
    this.transports.clear();
    if (this.httpServer) {
      const server = this.httpServer;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    this.mcpServer = null;
    this.httpServer = null;
    this.port = null;
    this.startPromise = null;
    log.info("Project canvas MCP stopped");
  }
}

function toolText(text: string): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text" as const, text }] };
}
