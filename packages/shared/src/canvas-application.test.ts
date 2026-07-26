import { describe, expect, it } from "vitest";
import {
  canvasCapabilitiesSchema,
  canvasSourceProjectSchema,
  createLegacyReactCanvasProject,
} from "./canvas-application";

describe("canvasSourceProjectSchema", () => {
  const validProject = {
    schemaVersion: 1,
    files: {
      "index.html":
        '<div id="root"></div><script type="module" src="/src/main.ts"></script>',
      "src/main.ts": 'document.querySelector("#root")!.textContent = "Hello";',
    },
    entryHtml: "index.html",
    dependencies: {},
    canvasSdkVersion: "1.0.0",
    capabilities: {
      posthog: { insights: [], inlineQueries: false, captureEvents: [] },
      network: { origins: [] },
    },
  } as const;

  it("accepts a bounded browser project", () => {
    expect(canvasSourceProjectSchema.parse(validProject)).toEqual(validProject);
  });

  it.each([
    ["absolute path", "/etc/passwd"],
    ["parent traversal", "src/../secret.ts"],
    ["backslash path", "src\\main.ts"],
    ["empty segment", "src//main.ts"],
  ])("rejects an unsafe %s", (_label, path) => {
    const files = { ...validProject.files, [path]: "nope" };
    expect(() =>
      canvasSourceProjectSchema.parse({ ...validProject, files }),
    ).toThrow();
  });

  it.each(["latest", "^1.2.3", "~1.2.3", "*", "github:owner/repo"])(
    "rejects non-exact dependency version %s",
    (version) => {
      expect(() =>
        canvasSourceProjectSchema.parse({
          ...validProject,
          dependencies: { three: version },
        }),
      ).toThrow();
    },
  );

  it("requires the declared HTML entry to exist", () => {
    expect(() =>
      canvasSourceProjectSchema.parse({
        ...validProject,
        files: { "src/main.ts": "" },
      }),
    ).toThrow();
  });
});

describe("canvasCapabilitiesSchema", () => {
  it("normalizes duplicate declared resources", () => {
    expect(
      canvasCapabilitiesSchema.parse({
        posthog: {
          insights: ["abc", "abc"],
          inlineQueries: false,
          captureEvents: ["clicked", "clicked"],
        },
        network: { origins: ["https://example.com", "https://example.com"] },
      }),
    ).toEqual({
      posthog: {
        insights: ["abc"],
        inlineQueries: false,
        captureEvents: ["clicked"],
      },
      network: { origins: ["https://example.com"] },
    });
  });

  it.each(["http://example.com", "https://example.com/path", "not-a-url"])(
    "rejects unsafe network origin %s",
    (origin) => {
      expect(() =>
        canvasCapabilitiesSchema.parse({
          posthog: { insights: [], inlineQueries: false, captureEvents: [] },
          network: { origins: [origin] },
        }),
      ).toThrow();
    },
  );
});

describe("createLegacyReactCanvasProject", () => {
  it("wraps an existing default component in the canonical project", () => {
    const project = createLegacyReactCanvasProject(
      "export default function App() { return <main>Hello</main>; }",
    );

    expect(project.entryHtml).toBe("index.html");
    expect(project.files["src/App.tsx"]).toContain("function App");
    expect(project.files["src/main.tsx"]).toContain("createRoot");
    expect(project.dependencies.react).toMatch(/^\d+\.\d+\.\d+/);
    expect(() => canvasSourceProjectSchema.parse(project)).not.toThrow();
  });
});
