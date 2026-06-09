/**
 * Fast Playwright captures of the PostHog Code Vite preview (?previewMode=true).
 *
 * Batch / repeated captures (fast — one browser, hash navigation between routes):
 *   pnpm --filter code screenshot:preview:serve          # background
 *   pnpm --filter code screenshot:preview -- --route /code/inbox/pulls -o a.png
 *
 * One-shot (launches Chromium once, then exits):
 *   pnpm --filter code screenshot:preview -- --route /code/inbox/pulls -o a.png
 */

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "@playwright/test";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SERVER_FILE = resolve(
  SCRIPT_DIR,
  "../node_modules/.cache/screenshot-preview-server.json",
);
const DEFAULT_BASE = "http://localhost:5173/?previewMode=true";
const DEFAULT_VIEWPORT = { width: 1280, height: 900 };
const DEFAULT_TIMEOUT_MS = 10_000;
const LOADING_TIMEOUT_MS = 2_000;

interface CaptureRequest {
  baseUrl: string;
  route: string | null;
  url: string | null;
  output: string;
  fullPage: boolean;
  waitFor: string | null;
  timeoutMs: number;
}

interface ServerInfo {
  port: number;
}

interface CliOptions extends CaptureRequest {
  mode: "capture" | "serve";
}

function printUsage(): void {
  process.stderr.write(`Usage:
  screenshot-dev-preview.ts --route <hash-route> [-o <file.png>] [options]
  screenshot-dev-preview.ts --url <full-preview-url> [-o <file.png>] [options]
  screenshot-dev-preview.ts --serve

Options:
  --route, --url, -o/--output, --full-page, --wait-for, --base-url, --timeout
  --serve   Persistent browser + HTTP capture API (use screenshot:preview:serve)
  -h, --help
`);
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let mode: CliOptions["mode"] = "capture";
  let baseUrl = DEFAULT_BASE;
  let route: string | null = null;
  let url: string | null = null;
  let output = `screenshot-${Date.now()}.png`;
  let fullPage = false;
  let waitFor: string | null = null;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      case "--serve":
        mode = "serve";
        break;
      case "--route":
        route = next ?? null;
        i += 1;
        break;
      case "--url":
        url = next ?? null;
        i += 1;
        break;
      case "--output":
      case "-o":
        output = next ?? output;
        i += 1;
        break;
      case "--full-page":
        fullPage = true;
        break;
      case "--wait-for":
        waitFor = next ?? null;
        i += 1;
        break;
      case "--base-url":
        baseUrl = next ?? baseUrl;
        i += 1;
        break;
      case "--timeout":
        timeoutMs = Number(next ?? timeoutMs);
        i += 1;
        break;
      default:
        process.stderr.write(`Unknown argument: ${arg}\n`);
        printUsage();
        process.exit(1);
    }
  }

  if (mode === "capture" && !route && !url) {
    process.stderr.write("Provide --route or --url (or --serve).\n");
    printUsage();
    process.exit(1);
  }

  if (route && url) {
    process.stderr.write("Use only one of --route or --url.\n");
    process.exit(1);
  }

  return {
    mode,
    baseUrl,
    route,
    url,
    output,
    fullPage,
    waitFor,
    timeoutMs,
  };
}

function buildPreviewUrl(request: CaptureRequest): string {
  if (request.url) {
    return request.url;
  }

  const normalizedRoute = request.route?.startsWith("#")
    ? request.route.slice(1)
    : (request.route ?? "");
  const hashPath = normalizedRoute.startsWith("/")
    ? normalizedRoute
    : `/${normalizedRoute}`;

  return `${request.baseUrl}#${hashPath}`;
}

function previewBaseKey(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.origin}${url.pathname}${url.search}`;
}

function readServerInfo(): ServerInfo | null {
  try {
    return JSON.parse(readFileSync(SERVER_FILE, "utf8")) as ServerInfo;
  } catch {
    return null;
  }
}

function writeServerInfo(info: ServerInfo): void {
  mkdirSync(dirname(SERVER_FILE), { recursive: true });
  writeFileSync(SERVER_FILE, JSON.stringify(info), "utf8");
}

function clearServerInfo(): void {
  try {
    unlinkSync(SERVER_FILE);
  } catch {
    // already gone
  }
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

async function waitForPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
  );
}

async function waitForReady(
  page: Page,
  request: CaptureRequest,
): Promise<void> {
  await page.waitForSelector("#root > *", { timeout: request.timeoutMs });

  const loading = page.locator("text=Loading").first();
  if (await loading.isVisible().catch(() => false)) {
    await loading
      .waitFor({ state: "hidden", timeout: LOADING_TIMEOUT_MS })
      .catch(() => {});
  }

  if (request.waitFor) {
    await page
      .getByText(request.waitFor, { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: request.timeoutMs });
  }

  await waitForPaint(page);
}

async function navigatePreview(
  page: Page,
  targetUrl: string,
  request: CaptureRequest,
): Promise<void> {
  const target = new URL(targetUrl);
  const baseKey = previewBaseKey(request.baseUrl);
  const current = page.url();
  const onPreviewBase =
    current.startsWith(baseKey) || current.startsWith(`${baseKey}#`);

  if (onPreviewBase && target.hash) {
    const currentHash = new URL(current).hash;
    if (currentHash !== target.hash) {
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, target.hash);
    }
    await waitForReady(page, request);
    return;
  }

  await page.goto(targetUrl, {
    waitUntil: "commit",
    timeout: request.timeoutMs,
  });
  await waitForReady(page, request);
}

async function captureToFile(
  page: Page,
  request: CaptureRequest,
): Promise<string> {
  const targetUrl = buildPreviewUrl(request);
  const outputPath = resolve(process.cwd(), request.output);
  mkdirSync(dirname(outputPath), { recursive: true });

  await navigatePreview(page, targetUrl, request);
  await page.screenshot({ path: outputPath, fullPage: request.fullPage });
  return outputPath;
}

async function captureViaServer(
  request: CaptureRequest,
): Promise<string | null> {
  const info = readServerInfo();
  if (!info) {
    return null;
  }

  try {
    const response = await fetch(`http://127.0.0.1:${info.port}/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(request.timeoutMs + 5_000),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return (await response.text()).trim();
  } catch {
    clearServerInfo();
    return null;
  }
}

async function captureOneShot(request: CaptureRequest): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
  const page = await context.newPage();

  try {
    return await captureToFile(page, request);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runServe(): Promise<void> {
  const browser: Browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
  const page = await context.newPage();

  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/capture") {
      res.writeHead(404);
      res.end();
      return;
    }

    try {
      const request = await readJsonBody<CaptureRequest>(req);
      const outputPath = await captureToFile(page, request);
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(outputPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(message);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind screenshot preview server");
  }

  writeServerInfo({ port: address.port });
  process.stderr.write(
    `screenshot preview server on http://127.0.0.1:${address.port}\n`,
  );

  const shutdown = async () => {
    clearServerInfo();
    server.close();
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise<void>(() => {});
}

async function runCapture(options: CliOptions): Promise<void> {
  if (options.url && !options.url.includes("previewMode=true")) {
    process.stderr.write(
      "Warning: URL missing ?previewMode=true — app may not boot.\n",
    );
  }

  const outputPath =
    (await captureViaServer(options)) ?? (await captureOneShot(options));
  process.stdout.write(`${outputPath}\n`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.mode === "serve") {
    await runServe();
    return;
  }

  await runCapture(options);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`screenshot-dev-preview failed: ${message}\n`);
  process.exit(1);
});
