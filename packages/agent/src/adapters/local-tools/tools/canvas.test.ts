import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_APPROVED_LOCAL_TOOL_IDS } from "../index";
import {
  canvasCheckoutTool,
  canvasScratchDir,
  canvasScratchFile,
} from "./canvas";

// Version composition and the stale-base rejection live server-side in the
// desktop-fs canvas action (and are tested there); the tool's own logic is
// the scratch-file plumbing and create-time channel placement.
describe("canvas scratch paths", () => {
  it("keys the scratch dir and file by canvas id, outside any workspace", () => {
    expect(canvasScratchDir("dash-1")).toBe("/tmp/posthog-canvas/dash-1");
    expect(canvasScratchFile("dash-1")).toBe(
      "/tmp/posthog-canvas/dash-1/canvas.tsx",
    );
  });
});

describe("canvas tool permissions", () => {
  it("auto-approves canvas_checkout (read-only) but not canvas_publish (write)", () => {
    expect(
      AUTO_APPROVED_LOCAL_TOOL_IDS.has(
        "mcp__posthog-code-tools__canvas_checkout",
      ),
    ).toBe(true);
    expect(
      AUTO_APPROVED_LOCAL_TOOL_IDS.has(
        "mcp__posthog-code-tools__canvas_publish",
      ),
    ).toBe(false);
  });
});

// Create-if-missing placement: the channel is resolved tool-side from the
// task's desktop-fs filing row (`type=task&ref=<taskId>`), never from a
// model-relayed channel name. Requests are matched on their query string, so
// the credential source (env vs a live /tmp/agent-env) doesn't matter.
describe("canvas_checkout create-if-missing placement", () => {
  const ctx = { cwd: "/tmp", taskId: "task-1" };
  let requests: { url: string; method: string; body?: unknown }[];
  let routes: ((url: string, method: string) => unknown | undefined)[];

  beforeEach(() => {
    vi.stubEnv("POSTHOG_API_URL", "http://posthog.test");
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "phx_test");
    vi.stubEnv("POSTHOG_PROJECT_ID", "1");
    requests = [];
    routes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        requests.push({ url, method, body });
        for (const route of routes) {
          const result = route(url, method);
          if (result !== undefined) {
            return new Response(JSON.stringify(result), { status: 200 });
          }
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("places the canvas in the task's channel folder with the app's meta shape", async () => {
    routes.push((url, method) => {
      if (url.includes("type=task&ref=task-1")) {
        return {
          results: [
            { id: "fs-home", path: "Unfiled/Tasks/My task", type: "task" },
            { id: "fs-filed", path: "demo-channel/My task", type: "task" },
          ],
        };
      }
      if (
        url.includes(`type=folder&path=${encodeURIComponent("demo-channel")}`)
      ) {
        return {
          results: [{ id: "folder-1", path: "demo-channel", type: "folder" }],
        };
      }
      if (method === "POST" && url.endsWith("/desktop_file_system/")) {
        return {
          id: "canvas-1",
          path: "demo-channel/My Canvas",
          type: "dashboard",
          meta: {},
        };
      }
      return undefined;
    });

    const result = await canvasCheckoutTool.handler(ctx, {
      name: "My Canvas",
    });

    expect(result.isError).toBeUndefined();
    const create = requests.find((r) => r.method === "POST");
    expect(create?.body).toMatchObject({
      path: "demo-channel/My Canvas",
      type: "dashboard",
      meta: { channelId: "folder-1", templateId: "freeform" },
    });
  });

  it("refuses (naming existing channels) when the task isn't filed in one", async () => {
    routes.push((url) => {
      if (url.includes("type=task&ref=task-1")) return { results: [] };
      if (url.includes("type=folder&depth=1")) {
        return { results: [{ id: "f1", path: "demo-channel" }] };
      }
      return undefined;
    });

    const result = await canvasCheckoutTool.handler(ctx, { name: "Orphan" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"demo-channel"');
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("refuses a parentPath that matches no existing folder instead of minting one", async () => {
    routes.push((url) => {
      if (
        url.includes(`type=folder&path=${encodeURIComponent("Demo Channel")}`)
      ) {
        return { results: [] };
      }
      if (url.includes("type=folder&depth=1")) {
        return { results: [{ id: "f1", path: "demo-channel" }] };
      }
      return undefined;
    });

    const result = await canvasCheckoutTool.handler(ctx, {
      name: "My Canvas",
      parentPath: "Demo Channel",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Demo Channel");
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("honors an explicit parentPath that resolves to a real folder", async () => {
    routes.push((url, method) => {
      if (url.includes(`type=folder&path=${encodeURIComponent("other")}`)) {
        return { results: [{ id: "folder-2", path: "other", type: "folder" }] };
      }
      if (method === "POST" && url.endsWith("/desktop_file_system/")) {
        return {
          id: "canvas-2",
          path: "other/Board",
          type: "dashboard",
          meta: {},
        };
      }
      return undefined;
    });

    const result = await canvasCheckoutTool.handler(ctx, {
      name: "Board",
      parentPath: "other",
    });

    expect(result.isError).toBeUndefined();
    const create = requests.find((r) => r.method === "POST");
    expect(create?.body).toMatchObject({
      path: "other/Board",
      meta: { channelId: "folder-2" },
    });
    // The task-filing lookup is skipped entirely on an explicit override.
    expect(requests.some((r) => r.url.includes("type=task"))).toBe(false);
  });
});
