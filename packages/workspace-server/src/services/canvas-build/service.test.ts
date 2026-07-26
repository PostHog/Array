import type { CanvasSourceProject } from "@posthog/shared/canvas-application";
import { describe, expect, it } from "vitest";
import { CanvasBuildService } from "./service";

function project(
  source: string,
  overrides: Partial<CanvasSourceProject> = {},
): CanvasSourceProject {
  return {
    schemaVersion: 1,
    files: {
      "index.html":
        '<!doctype html><div id="root"></div><script type="module" src="/src/main.ts"></script>',
      "src/main.ts": source,
    },
    entryHtml: "index.html",
    dependencies: {},
    canvasSdkVersion: "1.0.0",
    capabilities: {
      posthog: { insights: [], inlineQueries: false, captureEvents: [] },
      network: { origins: [] },
    },
    ...overrides,
  };
}

describe("CanvasBuildService", () => {
  const service = new CanvasBuildService();

  it("bundles a vanilla TypeScript application into immutable files", async () => {
    const result = await service.build({
      canvasId: "canvas-1",
      sourceVersionId: null,
      project: project(
        'const target: HTMLElement | null = document.querySelector("#root"); if (target) target.textContent = "Hello";',
      ),
      mode: "validate",
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.artifactFiles?.["index.html"]).not.toContain("/src/main.ts");
    expect(Object.keys(result.artifactFiles ?? {})).toContain("assets/main.js");
    expect(result.artifactFiles?.["index.html"]).toContain(
      "Content-Security-Policy",
    );
    expect(result.artifactFiles?.["index.html"]).toContain(
      "./assets/canvas-runtime.js",
    );
    expect(result.artifactFiles?.["assets/canvas-runtime.js"]).toContain(
      'channel="posthog-canvas"',
    );
    expect(result.manifest?.files.map((file) => file.path)).toEqual([
      "assets/canvas-runtime.js",
      "assets/main.js",
      "index.html",
    ]);
  });

  it("bundles React and Quill through the same application contract", async () => {
    const result = await service.build({
      canvasId: "canvas-react",
      sourceVersionId: null,
      project: project(
        'import React from "react"; import { createRoot } from "react-dom/client"; import { Button } from "@posthog/quill"; createRoot(document.querySelector("#root")!).render(React.createElement(Button, null, "Go"));',
        {
          dependencies: {
            "@posthog/quill": "0.3.0-beta.24",
            react: "19.2.6",
            "react-dom": "19.2.6",
          },
        },
      ),
      mode: "validate",
    });

    expect(result.ok).toBe(true);
  });

  it("bundles Three.js without introducing a canvas kind", async () => {
    const result = await service.build({
      canvasId: "canvas-three",
      sourceVersionId: null,
      project: project(
        'import { Scene } from "three"; window.__scene = new Scene();',
        { dependencies: { three: "0.183.2" } },
      ),
      mode: "validate",
    });

    expect(result.ok).toBe(true);
  });

  it("rejects imported packages that are not declared", async () => {
    const result = await service.build({
      canvasId: "canvas-undeclared",
      sourceVersionId: null,
      project: project('import React from "react"; void React;'),
      mode: "validate",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "undeclared_dependency" }),
    );
  });

  it.each(['import "node:fs";', 'import "fs";'])(
    "rejects Node built-ins: %s",
    async (source) => {
      const result = await service.build({
        canvasId: "canvas-node",
        sourceVersionId: null,
        project: project(source),
        mode: "validate",
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "forbidden_import" }),
      );
    },
  );

  it.each([
    ["insight", 'ph.loadInsight("abc")', "undeclared_insight"],
    ["inline query", 'ph.query("select 1")', "undeclared_inline_query"],
    ["capture event", 'ph.capture("clicked")', "undeclared_capture_event"],
    [
      "network origin",
      'fetch("https://example.com/data")',
      "undeclared_network_origin",
    ],
  ])("rejects an undeclared %s capability", async (_label, source, code) => {
    const result = await service.build({
      canvasId: "canvas-capability",
      sourceVersionId: null,
      project: project(source),
      mode: "validate",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code }),
    );
  });

  it("accepts declared data and network capabilities", async () => {
    const result = await service.build({
      canvasId: "canvas-capabilities",
      sourceVersionId: null,
      project: project(
        'ph.loadInsight("abc"); ph.query("select 1"); ph.capture("clicked"); fetch("https://example.com/data");',
        {
          capabilities: {
            posthog: {
              insights: ["abc"],
              inlineQueries: true,
              captureEvents: ["clicked"],
            },
            network: { origins: ["https://example.com"] },
          },
        },
      ),
      mode: "validate",
    });

    expect(result.ok).toBe(true);
    expect(result.artifactFiles?.["index.html"]).toContain(
      "connect-src https://example.com",
    );
  });

  it("rejects remote scripts in source HTML", async () => {
    const result = await service.build({
      canvasId: "canvas-script",
      sourceVersionId: null,
      project: project("", {
        files: {
          "index.html":
            '<script src="https://evil.example/payload.js"></script>',
        },
      }),
      mode: "validate",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "remote_script" }),
    );
  });
});
