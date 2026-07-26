import { z } from "zod";

export const CANVAS_SOURCE_SCHEMA_VERSION = 1 as const;
export const CANVAS_MAX_FILES = 128;
export const CANVAS_MAX_FILE_BYTES = 1_000_000;
export const CANVAS_MAX_SOURCE_BYTES = 5_000_000;

const exactPackageVersion =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isSafeProjectPath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

const projectPathSchema = z
  .string()
  .max(240)
  .refine(isSafeProjectPath, "Path must be project-relative and normalized");

const httpsOriginSchema = z.string().superRefine((value, ctx) => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.origin !== value ||
      url.username ||
      url.password
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Network capability must be an HTTPS origin",
      });
    }
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Network capability must be a valid HTTPS origin",
    });
  }
});

export const canvasCapabilitiesSchema = z
  .object({
    posthog: z.object({
      insights: z.array(z.string().min(1).max(128)).max(256).transform(unique),
      inlineQueries: z.boolean(),
      captureEvents: z
        .array(z.string().min(1).max(200))
        .max(256)
        .transform(unique),
    }),
    network: z.object({
      origins: z.array(httpsOriginSchema).max(64).transform(unique),
    }),
  })
  .strict();

const sourceFilesSchema = z
  .record(projectPathSchema, z.string())
  .refine(
    (files) => Object.keys(files).length <= CANVAS_MAX_FILES,
    `Canvas projects may contain at most ${CANVAS_MAX_FILES} files`,
  )
  .refine(
    (files) =>
      Object.values(files).every(
        (content) => utf8Bytes(content) <= CANVAS_MAX_FILE_BYTES,
      ),
    `Canvas files may contain at most ${CANVAS_MAX_FILE_BYTES} bytes`,
  )
  .refine(
    (files) =>
      Object.values(files).reduce(
        (total, content) => total + utf8Bytes(content),
        0,
      ) <= CANVAS_MAX_SOURCE_BYTES,
    `Canvas projects may contain at most ${CANVAS_MAX_SOURCE_BYTES} bytes`,
  );

const dependenciesSchema = z.record(
  z.string().regex(packageName, "Invalid package name"),
  z.string().regex(exactPackageVersion, "Dependency version must be exact"),
);

export const canvasSourceProjectSchema = z
  .object({
    schemaVersion: z.literal(CANVAS_SOURCE_SCHEMA_VERSION),
    files: sourceFilesSchema,
    entryHtml: z.literal("index.html"),
    dependencies: dependenciesSchema,
    canvasSdkVersion: z
      .string()
      .regex(exactPackageVersion, "Canvas SDK version must be exact"),
    capabilities: canvasCapabilitiesSchema,
  })
  .strict()
  .superRefine((project, ctx) => {
    if (!(project.entryHtml in project.files)) {
      ctx.addIssue({
        code: "custom",
        path: ["entryHtml"],
        message: "Canvas HTML entry is missing from source files",
      });
    }
  });

export const canvasDiagnosticSchema = z
  .object({
    severity: z.enum(["error", "warning", "info"]),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(10_000),
    file: projectPathSchema.optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().nonnegative().optional(),
  })
  .strict();

export const canvasArtifactFileSchema = z
  .object({
    path: projectPathSchema,
    contentType: z.string().min(1).max(200),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const canvasArtifactManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    entryHtml: projectPathSchema,
    files: z.array(canvasArtifactFileSchema).max(512),
    canvasSdkVersion: z.string().regex(exactPackageVersion),
    dependencies: dependenciesSchema,
    capabilities: canvasCapabilitiesSchema,
  })
  .strict();

export const canvasBuildModeSchema = z.enum(["validate", "publish"]);

export const canvasBuildRequestSchema = z
  .object({
    canvasId: z.string().min(1),
    sourceVersionId: z.string().min(1).nullable(),
    project: canvasSourceProjectSchema,
    mode: canvasBuildModeSchema,
  })
  .strict();

export const canvasBuildResultSchema = z
  .object({
    ok: z.boolean(),
    diagnostics: z.array(canvasDiagnosticSchema).max(500),
    manifest: canvasArtifactManifestSchema.optional(),
    artifactFiles: z.record(projectPathSchema, z.string()).optional(),
  })
  .strict();

export const canvasSourceVersionSchema = z
  .object({
    id: z.string().min(1),
    parentVersionId: z.string().min(1).nullable(),
    taskId: z.string().min(1),
    taskRunId: z.string().min(1),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceSize: z.number().int().nonnegative(),
    prompt: z.string().max(10_000).optional(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const canvasPersistedBuildSchema = z
  .object({
    id: z.string().min(1),
    sourceVersionId: z.string().min(1),
    status: z.enum(["queued", "building", "ready", "failed"]),
    artifactUrl: z.url().optional(),
    integrity: z
      .string()
      .regex(/^sha256-[A-Za-z0-9+/=]+$/)
      .optional(),
    diagnostics: z.array(canvasDiagnosticSchema).max(500),
    manifest: canvasArtifactManifestSchema.optional(),
    createdAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export const canvasSourceSnapshotSchema = z
  .object({
    version: canvasSourceVersionSchema,
    project: canvasSourceProjectSchema,
  })
  .strict();

export const canvasPublishRequestSchema = z
  .object({
    project: canvasSourceProjectSchema,
    expectedCurrentVersionId: z.string().min(1).nullable(),
    taskId: z.string().min(1),
    taskRunId: z.string().min(1),
    prompt: z.string().max(10_000).optional(),
  })
  .strict();

export const canvasPublishResultSchema = z
  .object({
    version: canvasSourceVersionSchema,
    build: canvasPersistedBuildSchema,
  })
  .strict();

export const canvasHistorySchema = z
  .object({
    currentSourceVersionId: z.string().min(1).nullable(),
    activeBuildId: z.string().min(1).nullable(),
    versions: z.array(canvasSourceVersionSchema),
    builds: z.array(canvasPersistedBuildSchema),
  })
  .strict();

export const canvasVersionConflictSchema = z
  .object({
    code: z.literal("version_conflict"),
    detail: z.string(),
    currentVersionId: z.string().nullable(),
  })
  .strict();

export const canvasApplicationIdInputSchema = z
  .object({ canvasId: z.string().min(1) })
  .strict();

export const canvasApplicationBuildInputSchema = canvasApplicationIdInputSchema
  .extend({ buildId: z.string().min(1) })
  .strict();

export const canvasApplicationPublishInputSchema = canvasPublishRequestSchema
  .extend({ canvasId: z.string().min(1) })
  .strict();

export type CanvasCapabilities = z.infer<typeof canvasCapabilitiesSchema>;
export type CanvasSourceProject = z.infer<typeof canvasSourceProjectSchema>;
export type CanvasDiagnostic = z.infer<typeof canvasDiagnosticSchema>;
export type CanvasArtifactFile = z.infer<typeof canvasArtifactFileSchema>;
export type CanvasArtifactManifest = z.infer<
  typeof canvasArtifactManifestSchema
>;
export type CanvasBuildMode = z.infer<typeof canvasBuildModeSchema>;
export type CanvasBuildRequest = z.infer<typeof canvasBuildRequestSchema>;
export type CanvasBuildResult = z.infer<typeof canvasBuildResultSchema>;
export type CanvasSourceVersion = z.infer<typeof canvasSourceVersionSchema>;
export type CanvasPersistedBuild = z.infer<typeof canvasPersistedBuildSchema>;
export type CanvasSourceSnapshot = z.infer<typeof canvasSourceSnapshotSchema>;
export type CanvasPublishRequest = z.infer<typeof canvasPublishRequestSchema>;
export type CanvasPublishResult = z.infer<typeof canvasPublishResultSchema>;
export type CanvasHistory = z.infer<typeof canvasHistorySchema>;
export type CanvasVersionConflict = z.infer<typeof canvasVersionConflictSchema>;

const LEGACY_REACT_VERSION = "19.2.6";
const LEGACY_QUILL_VERSION = "0.3.0-beta.24";

export function createLegacyReactCanvasProject(
  source: string,
): CanvasSourceProject {
  return canvasSourceProjectSchema.parse({
    schemaVersion: CANVAS_SOURCE_SCHEMA_VERSION,
    files: {
      "index.html":
        '<!doctype html><html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
      "src/main.tsx":
        'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\n\ncreateRoot(document.getElementById("root")!).render(<App />);\n',
      "src/App.tsx": source,
      "src/style.css": "",
    },
    entryHtml: "index.html",
    dependencies: {
      "@posthog/quill": LEGACY_QUILL_VERSION,
      react: LEGACY_REACT_VERSION,
      "react-dom": LEGACY_REACT_VERSION,
    },
    canvasSdkVersion: "1.0.0",
    capabilities: {
      posthog: { insights: [], inlineQueries: true, captureEvents: [] },
      network: { origins: [] },
    },
  });
}
