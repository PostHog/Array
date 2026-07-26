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

  it.each([
    ["d3", "7.9.0", 'import { scaleLinear } from "d3"; scaleLinear();'],
    [
      "date-fns",
      "4.1.0",
      'import { format } from "date-fns"; format(new Date(), "yyyy");',
    ],
    ["echarts", "6.1.0", 'import * as echarts from "echarts"; void echarts;'],
    [
      "lodash-es",
      "4.18.1",
      'import { groupBy } from "lodash-es"; groupBy([]);',
    ],
    ["zod", "4.4.3", 'import { z } from "zod"; z.string();'],
  ])("bundles admitted package %s", async (name, version, source) => {
    const result = await service.build({
      canvasId: `canvas-${name}`,
      sourceVersionId: null,
      project: project(source, { dependencies: { [name]: version } }),
      mode: "validate",
    });

    expect(result.ok).toBe(true);
  });

  it("bundles imported image and WebAssembly assets", async () => {
    const result = await service.build({
      canvasId: "canvas-assets",
      sourceVersionId: null,
      project: project(
        'import image from "../assets/pixel.png"; import wasm from "../assets/module.wasm"; document.body.dataset.image = image; document.body.dataset.wasm = String(wasm.length);',
        {
          assets: {
            "assets/pixel.png": {
              encoding: "base64",
              contentType: "image/png",
              content: "iVBORw0KGgo=",
            },
            "assets/module.wasm": {
              encoding: "base64",
              contentType: "application/wasm",
              content: "AGFzbQEAAAA=",
            },
          },
        },
      ),
      mode: "validate",
    });

    expect(result.ok).toBe(true);
    expect(result.artifactFiles?.["assets/main.js"]).toContain(
      "data:image/png;base64",
    );
  });

  it("compiles a module worker imported with the worker query", async () => {
    const result = await service.build({
      canvasId: "canvas-worker",
      sourceVersionId: null,
      project: project(
        'import workerUrl from "./worker.ts?worker"; new Worker(workerUrl, { type: "module" });',
        {
          files: {
            "index.html": '<script type="module" src="/src/main.ts"></script>',
            "src/main.ts":
              'import workerUrl from "./worker.ts?worker"; new Worker(workerUrl, { type: "module" });',
            "src/worker.ts": 'self.postMessage("ready")',
          },
        },
      ),
      mode: "validate",
    });

    expect(result.ok).toBe(true);
    expect(result.artifactFiles?.["assets/main.js"]).toContain("new Blob");
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

  it("rejects workspace dependencies outside the admitted canvas set", async () => {
    const result = await service.build({
      canvasId: "canvas-workspace-package",
      sourceVersionId: null,
      project: project('import "left-pad";', {
        dependencies: { "left-pad": "1.3.0" },
      }),
      mode: "validate",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "dependency_unavailable" }),
    );
  });

  it("rejects undeclared packages in dynamic imports", async () => {
    const result = await service.build({
      canvasId: "canvas-dynamic",
      sourceVersionId: null,
      project: project('void import("react");'),
      mode: "validate",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "compile_error" }),
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

  it("rejects package subpath traversal", async () => {
    const result = await service.build({
      canvasId: "canvas-traversal",
      sourceVersionId: null,
      project: project('import "react/../../outside";', {
        dependencies: { react: "19.2.6" },
      }),
      mode: "validate",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "forbidden_import" }),
    );
  });

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

  it("accepts declared data capabilities but blocks external egress until approval exists", async () => {
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

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "network_capability_unavailable" }),
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

  it.each([
    [
      "inline event handler",
      '<button onclick="alert(1)">Go</button>',
      "inline_event_handler",
    ],
    [
      "JavaScript URL",
      '<a href="javascript:alert(1)">Go</a>',
      "javascript_url",
    ],
  ])("rejects an unsafe %s", async (_label, html, code) => {
    const result = await service.build({
      canvasId: "canvas-unsafe-html",
      sourceVersionId: null,
      project: project("", { files: { "index.html": html } }),
      mode: "validate",
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code }),
    );
  });
});
