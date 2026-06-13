/**
 * Fast screenshots of the PostHog Code Vite preview (?previewMode=true) via agent-browser.
 *
 * Repeated captures reuse one warm browser session, so batches are fast with no
 * separate serve step:
 *   pnpm --filter code screenshot:preview -- --route /code/inbox/pulls -o a.png
 *   pnpm --filter code screenshot:preview -- --route /code/inbox/reports -o b.png
 *
 * Requires agent-browser (npm i -g agent-browser && agent-browser install) and the
 * Vite dev server on :5173 (pnpm dev:code / pnpm dev:mprocs). Free the warm browser
 * with `agent-browser --session screenshot-preview close` when finished.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_BASE = "http://localhost:5173/?previewMode=true";
const DEFAULT_TIMEOUT_MS = 10_000;
const SESSION = "screenshot-preview";

interface CaptureRequest {
  baseUrl: string;
  route: string | null;
  url: string | null;
  output: string;
  fullPage: boolean;
  waitFor: string | null;
  timeoutMs: number;
}

function printUsage(): void {
  process.stderr.write(`Usage:
  screenshot-dev-preview.ts --route <hash-route> [-o <file.png>] [options]
  screenshot-dev-preview.ts --url <full-preview-url> [-o <file.png>] [options]

Options:
  --route, --url, -o/--output, --full-page, --wait-for, --base-url, --timeout
  -h, --help

Repeated runs reuse one warm browser; close it with:
  agent-browser --session ${SESSION} close
`);
}

function parseArgs(argv: string[]): CaptureRequest {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
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

  if (!route && !url) {
    process.stderr.write("Provide --route or --url.\n");
    printUsage();
    process.exit(1);
  }

  if (route && url) {
    process.stderr.write("Use only one of --route or --url.\n");
    process.exit(1);
  }

  return { baseUrl, route, url, output, fullPage, waitFor, timeoutMs };
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

function runAgentBrowser(
  args: string[],
  timeoutMs: number,
  optional = false,
): void {
  try {
    execFileSync("agent-browser", ["--session", SESSION, ...args], {
      env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: String(timeoutMs) },
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      process.stderr.write(
        "agent-browser is not installed. Run: npm i -g agent-browser && agent-browser install\n",
      );
      process.exit(1);
    }
    if (optional) {
      return;
    }
    throw error;
  }
}

function capture(request: CaptureRequest): string {
  const targetUrl = buildPreviewUrl(request);
  const outputPath = resolve(process.cwd(), request.output);
  mkdirSync(dirname(outputPath), { recursive: true });

  runAgentBrowser(["open", targetUrl], request.timeoutMs);
  runAgentBrowser(["wait", "#root > *"], request.timeoutMs);
  runAgentBrowser(
    ["wait", "--fn", "!document.body.innerText.includes('Loading')"],
    request.timeoutMs,
    true,
  );
  if (request.waitFor) {
    runAgentBrowser(["wait", "--text", request.waitFor], request.timeoutMs);
  }
  runAgentBrowser(["wait", "200"], request.timeoutMs, true);

  const screenshotArgs = ["screenshot", outputPath];
  if (request.fullPage) {
    screenshotArgs.push("--full");
  }
  runAgentBrowser(screenshotArgs, request.timeoutMs);

  return outputPath;
}

function main(): void {
  const request = parseArgs(process.argv.slice(2));

  if (request.url && !request.url.includes("previewMode=true")) {
    process.stderr.write(
      "Warning: URL missing ?previewMode=true — app may not boot.\n",
    );
  }

  const outputPath = capture(request);
  process.stdout.write(`${outputPath}\n`);
}

main();
