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
import { build, type Loader, type Plugin, transform } from "esbuild";
import { injectable } from "inversify";

const require = createRequire(import.meta.url);
const ADMITTED_DEPENDENCIES = new Map([
  ["@posthog/quill", "0.3.0-beta.24"],
  ["d3", "7.9.0"],
  ["date-fns", "4.1.0"],
  ["echarts", "6.1.0"],
  ["lodash-es", "4.18.1"],
  ["react", "19.2.6"],
  ["react-dom", "19.2.6"],
  ["three", "0.183.2"],
  ["zod", "4.4.3"],
]);
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
const INLINE_EVENT_HANDLER = /\son[a-z]+\s*=/i;
const JAVASCRIPT_URL = /\b(?:href|src)\s*=\s*["']\s*javascript:/i;
const CANVAS_RUNTIME_PATH = "assets/canvas-runtime.js";
const CANVAS_RUNTIME = `(()=>{const channel="posthog-canvas",pending=new Map;let sequence=0;const post=(message)=>parent.postMessage({channel,...message},"*");const call=(method,payload)=>new Promise((resolve,reject)=>{const id=String(++sequence);pending.set(id,{resolve,reject});post({type:"data-request",id,method,payload});});window.ph={loadInsight:(shortId,options)=>call("loadInsight",{shortId,dateRange:options?.dateRange}),query:(query,params)=>call("query",typeof query==="string"?{hogql:query,params:params??{}}:{query,params:params??{}}),capture:(event,properties,distinctId)=>call("capture",{event,properties:properties??{},distinctId}),openExternal:(url)=>post({type:"open-external",url}),navigate:{toTask:(taskId)=>post({type:"navigate",nav:{target:"task",taskId}}),toNewTask:()=>post({type:"navigate",nav:{target:"new-task"}}),toCanvas:(dashboardId)=>post({type:"navigate",nav:{target:"canvas",dashboardId}}),toNewCanvas:()=>post({type:"navigate",nav:{target:"new-canvas"}})}};addEventListener("message",(event)=>{if(event.source!==parent||event.data?.channel!==channel||event.data?.type!=="data-response")return;const request=pending.get(event.data.id);if(!request)return;pending.delete(event.data.id);event.data.ok?request.resolve(event.data.result):request.reject(new Error(event.data.error??"Canvas request failed"));});addEventListener("click",(event)=>{const anchor=event.target instanceof Element?event.target.closest("a[href]"):null;if(!anchor)return;event.preventDefault();const url=anchor.href;if(url)post({type:"open-external",url});});addEventListener("error",(event)=>post({type:"error",message:event.message||"Canvas runtime error",stack:event.error?.stack}));addEventListener("unhandledrejection",(event)=>post({type:"error",message:event.reason instanceof Error?event.reason.message:String(event.reason),stack:event.reason instanceof Error?event.reason.stack:undefined}));addEventListener("DOMContentLoaded",()=>post({type:"ready"}));addEventListener("load",()=>post({type:"rendered"}));})();`;

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

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function contentSecurityPolicy(project: CanvasSourceProject): string {
  const origins = project.capabilities.network.origins.join(" ");
  const connect = origins || "'none'";
  const externalAssets = origins ? ` ${origins}` : "";
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connect}`,
    `img-src 'self' data: blob:${externalAssets}`,
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
  ].join("; ");
}

function injectHead(html: string, markup: string): string {
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${markup}`);
  }
  const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0];
  if (doctype) {
    return html.replace(doctype, `${doctype}<head>${markup}</head>`);
  }
  return `<head>${markup}</head>${html}`;
}

function diagnostic(
  code: string,
  message: string,
  file?: string,
): CanvasDiagnostic {
  return { severity: "error", code, message: message.slice(0, 10_000), file };
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
  files: Record<string, unknown>,
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

function assetLoader(contentType: string): Loader {
  if (
    contentType === "application/wasm" ||
    contentType === "application/octet-stream"
  )
    return "binary";
  return "dataurl";
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
        NODE_BUILTINS.has(packageName(specifier)) ||
        specifier.includes("\\") ||
        specifier.split("/").includes("..")
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
    if (ADMITTED_DEPENDENCIES.get(name) !== declaredVersion) {
      diagnostics.push(
        diagnostic(
          "dependency_unavailable",
          `Package "${name}" at ${declaredVersion} is not admitted to the local canvas build cache`,
        ),
      );
      continue;
    }
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

  if (declaredOrigins.size > 0) {
    diagnostics.push(
      diagnostic(
        "network_capability_unavailable",
        "External network access is unavailable until canvas capability approval is implemented",
      ),
    );
  }

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
          const workerImport = args.path.endsWith("?worker");
          const requestedPath = workerImport
            ? args.path.slice(0, -7)
            : args.path;
          const resolved = resolveProjectFile(
            project.files,
            args.importer,
            requestedPath,
          );
          if (resolved) {
            return {
              path: resolved,
              namespace: workerImport ? "canvas-worker" : "canvas",
            };
          }
          const asset = resolveProjectFile(
            project.assets ?? {},
            args.importer,
            requestedPath,
          );
          if (asset) return { path: asset, namespace: "canvas-asset" };
          if (!resolved) {
            return {
              errors: [{ text: `Canvas source file not found: ${args.path}` }],
            };
          }
        }
        if (args.namespace === "canvas") {
          const name = packageName(args.path);
          if (
            NODE_BUILTINS.has(args.path) ||
            NODE_BUILTINS.has(name) ||
            args.path.includes("\\") ||
            args.path.split("/").includes("..") ||
            !project.dependencies[name]
          ) {
            return {
              errors: [
                { text: `Canvas dependency is not declared: ${args.path}` },
              ],
            };
          }
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
      pluginBuild.onLoad(
        { filter: /.*/, namespace: "canvas-asset" },
        (args) => {
          const asset = project.assets?.[args.path];
          if (!asset)
            return {
              errors: [{ text: `Canvas asset not found: ${args.path}` }],
            };
          return {
            contents: Uint8Array.from(Buffer.from(asset.content, "base64")),
            loader: assetLoader(asset.contentType),
          };
        },
      );
      pluginBuild.onLoad(
        { filter: /.*/, namespace: "canvas-worker" },
        async (args) => {
          const source = project.files[args.path];
          if (source === undefined)
            return {
              errors: [{ text: `Canvas worker not found: ${args.path}` }],
            };
          if (extractImportSpecifiers(source).length > 0) {
            return {
              errors: [
                { text: "Canvas workers must be self-contained modules" },
              ],
            };
          }
          const compiled = await transform(source, {
            format: "esm",
            loader: loaderFor(args.path),
            target: "es2022",
            minify: true,
          });
          return {
            contents: `export default URL.createObjectURL(new Blob([${JSON.stringify(compiled.code)}],{type:"text/javascript"}));`,
            loader: "js",
          };
        },
      );
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
    message: (entry.text ?? "Canvas compilation failed").slice(0, 10_000),
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
    if (INLINE_EVENT_HANDLER.test(html)) {
      diagnostics.push(
        diagnostic(
          "inline_event_handler",
          "Inline HTML event handlers are blocked; register events from a local module",
          project.entryHtml,
        ),
      );
    }
    if (JAVASCRIPT_URL.test(html)) {
      diagnostics.push(
        diagnostic(
          "javascript_url",
          "JavaScript URLs are not allowed in canvas HTML",
          project.entryHtml,
        ),
      );
    }
    if (diagnostics.length > 0) {
      return canvasBuildResultSchema.parse({
        ok: false,
        diagnostics: diagnostics.slice(0, 500),
      });
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
        return {
          ok: false,
          diagnostics: esbuildDiagnostics(error).slice(0, 500),
        };
      }
    }

    artifactFiles["index.html"] = builtHtml;
    artifactFiles[CANVAS_RUNTIME_PATH] = CANVAS_RUNTIME;
    const csp = contentSecurityPolicy(project);
    const runtimeMarkup = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}" /><script src="./${CANVAS_RUNTIME_PATH}"></script>`;
    artifactFiles["index.html"] = injectHead(
      artifactFiles["index.html"] ?? "",
      runtimeMarkup,
    );
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
