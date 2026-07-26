import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import {
  type CanvasArtifactFile,
  type CanvasBuildRequest,
  type CanvasBuildResult,
  type CanvasDiagnostic,
  type CanvasSourceProject,
  canvasBuildRequestSchema,
  canvasBuildResultSchema,
} from "@posthog/shared/canvas-application";
import { build, type Loader, type Plugin } from "esbuild";
import { injectable } from "inversify";

const require = createRequire(import.meta.url);
const JS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".css"];
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const MODULE_SCRIPT =
  /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']([^"']+)["'])[^>]*>\s*<\/script>/gi;
const ANY_REMOTE_SCRIPT =
  /<script\b[^>]*\bsrc=["'](?:https?:)?\/\/[^"']+["'][^>]*>/i;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i;

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function diagnostic(
  code: string,
  message: string,
  file?: string,
): CanvasDiagnostic {
  return { severity: "error", code, message, file };
}

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0] ?? specifier;
}

function installedPackageVersion(name: string): string | null {
  let directory = path.dirname(require.resolve(name));
  while (directory !== path.dirname(directory)) {
    const manifestPath = path.join(directory, "package.json");
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (manifest.name === name && manifest.version) return manifest.version;
    } catch {}
    directory = path.dirname(directory);
  }
  return null;
}

function loaderFor(filePath: string): Loader {
  const extension = path.posix.extname(filePath);
  if (extension === ".ts") return "ts";
  if (extension === ".tsx") return "tsx";
  if (extension === ".jsx") return "jsx";
  if (extension === ".css") return "css";
  if (extension === ".json") return "json";
  return "js";
}

function normalizeProjectPath(filePath: string): string {
  return path.posix.normalize(filePath.replace(/^\/+/, ""));
}

function resolveProjectFile(
  files: Record<string, string>,
  importer: string,
  specifier: string,
): string | null {
  const candidate = specifier.startsWith("/")
    ? normalizeProjectPath(specifier)
    : normalizeProjectPath(
        path.posix.join(path.posix.dirname(importer), specifier),
      );
  const candidates = [
    candidate,
    ...JS_EXTENSIONS.map((extension) => `${candidate}${extension}`),
    ...JS_EXTENSIONS.map((extension) =>
      path.posix.join(candidate, `index${extension}`),
    ),
  ];
  return candidates.find((entry) => entry in files) ?? null;
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern =
    /(?:\bimport\s*(?:[^"']*?\sfrom\s*)?|\bexport\s+[^"']*?\sfrom\s*|\brequire\s*\()\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

function validateDependencies(
  project: CanvasSourceProject,
): CanvasDiagnostic[] {
  const diagnostics: CanvasDiagnostic[] = [];
  const imported = new Map<string, string>();

  for (const [file, source] of Object.entries(project.files)) {
    for (const specifier of extractImportSpecifiers(source)) {
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
      if (
        NODE_BUILTINS.has(specifier) ||
        NODE_BUILTINS.has(packageName(specifier))
      ) {
        diagnostics.push(
          diagnostic(
            "forbidden_import",
            `Node built-in import "${specifier}" is unavailable in canvases`,
            file,
          ),
        );
        continue;
      }
      imported.set(packageName(specifier), file);
    }
  }

  for (const [name, file] of imported) {
    const declaredVersion = project.dependencies[name];
    if (!declaredVersion) {
      diagnostics.push(
        diagnostic(
          "undeclared_dependency",
          `Package "${name}" must be declared with an exact version`,
          file,
        ),
      );
    }
  }

  for (const [name, declaredVersion] of Object.entries(project.dependencies)) {
    try {
      const installedVersion = installedPackageVersion(name);
      if (!installedVersion) throw new Error("Package manifest not found");
      if (installedVersion !== declaredVersion) {
        diagnostics.push(
          diagnostic(
            "dependency_version_mismatch",
            `Package "${name}" resolved to ${installedVersion}, expected ${declaredVersion}`,
          ),
        );
      }
    } catch {
      diagnostics.push(
        diagnostic(
          "dependency_unavailable",
          `Package "${name}" is not admitted to the local canvas build cache`,
        ),
      );
    }
  }

  return diagnostics;
}

function validateCapabilities(
  project: CanvasSourceProject,
): CanvasDiagnostic[] {
  const diagnostics: CanvasDiagnostic[] = [];
  const declaredInsights = new Set(project.capabilities.posthog.insights);
  const declaredEvents = new Set(project.capabilities.posthog.captureEvents);
  const declaredOrigins = new Set(project.capabilities.network.origins);

  for (const [file, source] of Object.entries(project.files)) {
    for (const match of source.matchAll(
      /\bph\.loadInsight\s*\(\s*["']([^"']+)["']/g,
    )) {
      const insight = match[1];
      if (insight && !declaredInsights.has(insight)) {
        diagnostics.push(
          diagnostic(
            "undeclared_insight",
            `Insight "${insight}" is not declared in canvas capabilities`,
            file,
          ),
        );
      }
    }
    if (
      /\bph\.query\s*\(/.test(source) &&
      !project.capabilities.posthog.inlineQueries
    ) {
      diagnostics.push(
        diagnostic(
          "undeclared_inline_query",
          "Inline PostHog queries require the inlineQueries capability",
          file,
        ),
      );
    }
    for (const match of source.matchAll(
      /\bph\.capture\s*\(\s*["']([^"']+)["']/g,
    )) {
      const event = match[1];
      if (event && !declaredEvents.has(event)) {
        diagnostics.push(
          diagnostic(
            "undeclared_capture_event",
            `Capture event "${event}" is not declared in canvas capabilities`,
            file,
          ),
        );
      }
    }
    for (const match of source.matchAll(
      /\b(?:fetch|WebSocket|EventSource)\s*\(\s*["'](https:\/\/[^"']+)["']/g,
    )) {
      const value = match[1];
      if (!value) continue;
      const origin = new URL(value).origin;
      if (!declaredOrigins.has(origin)) {
        diagnostics.push(
          diagnostic(
            "undeclared_network_origin",
            `Network origin "${origin}" is not declared in canvas capabilities`,
            file,
          ),
        );
      }
    }
  }
  return diagnostics;
}

function virtualProjectPlugin(project: CanvasSourceProject): Plugin {
  return {
    name: "canvas-project",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") {
          return { path: normalizeProjectPath(args.path), namespace: "canvas" };
        }
        if (
          args.namespace === "canvas" &&
          (args.path.startsWith(".") || args.path.startsWith("/"))
        ) {
          const resolved = resolveProjectFile(
            project.files,
            args.importer,
            args.path,
          );
          if (!resolved) {
            return {
              errors: [{ text: `Canvas source file not found: ${args.path}` }],
            };
          }
          return { path: resolved, namespace: "canvas" };
        }
        if (args.namespace === "canvas") {
          try {
            return { path: require.resolve(args.path) };
          } catch {
            return {
              errors: [{ text: `Canvas dependency not found: ${args.path}` }],
            };
          }
        }
        return null;
      });

      pluginBuild.onLoad({ filter: /.*/, namespace: "canvas" }, (args) => ({
        contents: project.files[args.path],
        loader: loaderFor(args.path),
        resolveDir: "/",
      }));
    },
  };
}

function esbuildDiagnostics(error: unknown): CanvasDiagnostic[] {
  if (!error || typeof error !== "object" || !("errors" in error)) {
    return [
      diagnostic(
        "build_failed",
        error instanceof Error ? error.message : String(error),
      ),
    ];
  }
  const errors =
    (
      error as {
        errors?: Array<{
          text?: string;
          location?: { file?: string; line?: number; column?: number };
        }>;
      }
    ).errors ?? [];
  return errors.map((entry) => ({
    severity: "error" as const,
    code: "compile_error",
    message: entry.text ?? "Canvas compilation failed",
    file: entry.location?.file
      ? normalizeProjectPath(entry.location.file)
      : undefined,
    line: entry.location?.line,
    column: entry.location?.column,
  }));
}

@injectable()
export class CanvasBuildService {
  async build(unparsed: CanvasBuildRequest): Promise<CanvasBuildResult> {
    const request = canvasBuildRequestSchema.parse(unparsed);
    const { project } = request;
    const html = project.files[project.entryHtml] ?? "";
    const diagnostics = [
      ...validateDependencies(project),
      ...validateCapabilities(project),
    ];

    if (ANY_REMOTE_SCRIPT.test(html)) {
      diagnostics.push(
        diagnostic(
          "remote_script",
          "Remote scripts must be installed as pinned dependencies and bundled",
          project.entryHtml,
        ),
      );
    }
    if (INLINE_SCRIPT.test(html)) {
      diagnostics.push(
        diagnostic(
          "inline_script",
          "Inline scripts are not allowed; move code into the module entry",
          project.entryHtml,
        ),
      );
    }
    if (diagnostics.length > 0) {
      return canvasBuildResultSchema.parse({ ok: false, diagnostics });
    }

    const moduleMatches = [...html.matchAll(MODULE_SCRIPT)];
    if (moduleMatches.length > 1) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            "multiple_entries",
            "Canvas HTML may load at most one local module entry",
            project.entryHtml,
          ),
        ],
      };
    }

    const artifactFiles: Record<string, string> = {};
    let builtHtml = html;
    const moduleSource = moduleMatches[0]?.[1];

    if (moduleSource) {
      if (/^(?:https?:)?\/\//.test(moduleSource)) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              "remote_script",
              "Remote module entries are not allowed",
            ),
          ],
        };
      }
      const entry = normalizeProjectPath(moduleSource);
      if (!(entry in project.files)) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              "missing_entry",
              `Canvas module entry "${entry}" does not exist`,
            ),
          ],
        };
      }

      try {
        const output = await build({
          absWorkingDir: process.cwd(),
          entryPoints: [entry],
          bundle: true,
          write: false,
          outdir: "out",
          entryNames: "assets/main",
          assetNames: "assets/[name]-[hash]",
          chunkNames: "assets/chunk-[hash]",
          format: "esm",
          platform: "browser",
          target: "es2022",
          treeShaking: true,
          minify: request.mode === "publish",
          legalComments: "none",
          sourcemap: false,
          plugins: [virtualProjectPlugin(project)],
          loader: {
            ".png": "dataurl",
            ".jpg": "dataurl",
            ".jpeg": "dataurl",
            ".gif": "dataurl",
            ".svg": "dataurl",
            ".woff": "dataurl",
            ".woff2": "dataurl",
          },
        });

        for (const file of output.outputFiles) {
          const relative = normalizeProjectPath(
            path.relative(path.join(process.cwd(), "out"), file.path),
          );
          artifactFiles[relative] = file.text;
        }
        builtHtml = builtHtml.replace(
          MODULE_SCRIPT,
          '<script type="module" src="./assets/main.js"></script>',
        );
        if (artifactFiles["assets/main.css"]) {
          builtHtml = builtHtml.replace(
            /<\/head>/i,
            '<link rel="stylesheet" href="./assets/main.css" /></head>',
          );
        }
      } catch (error) {
        return { ok: false, diagnostics: esbuildDiagnostics(error) };
      }
    }

    artifactFiles["index.html"] = builtHtml;
    const files: CanvasArtifactFile[] = Object.entries(artifactFiles)
      .map(([filePath, content]) => ({
        path: filePath,
        contentType: contentType(filePath),
        bytes: Buffer.byteLength(content),
        sha256: sha256(content),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

    return canvasBuildResultSchema.parse({
      ok: true,
      diagnostics: [],
      artifactFiles,
      manifest: {
        schemaVersion: 1,
        entryHtml: "index.html",
        files,
        canvasSdkVersion: project.canvasSdkVersion,
        dependencies: project.dependencies,
        capabilities: project.capabilities,
      },
    });
  }
}
