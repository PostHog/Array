import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  defineLocalTool,
  type LocalTool,
  type LocalToolCtx,
  type LocalToolResult,
} from "../registry";

const modifierSchema = z.enum(["command", "control", "option", "shift"]);
const namedKeySchema = z.enum([
  "enter",
  "tab",
  "escape",
  "delete",
  "space",
  "arrow_up",
  "arrow_down",
  "arrow_left",
  "arrow_right",
  "page_up",
  "page_down",
  "home",
  "end",
]);
const MAX_SCREENSHOT_BYTES = 1_000_000;
const screenshotCompressionAttempts = [
  { maxDimension: 1600, quality: "75" },
  { maxDimension: 1200, quality: "60" },
  { maxDimension: 900, quality: "45" },
] as const;
const macKeyCodes: Record<z.infer<typeof namedKeySchema>, number> = {
  enter: 36,
  tab: 48,
  escape: 53,
  delete: 51,
  space: 49,
  arrow_up: 126,
  arrow_down: 125,
  arrow_left: 123,
  arrow_right: 124,
  page_up: 116,
  page_down: 121,
  home: 115,
  end: 119,
};
const linuxKeys: Record<z.infer<typeof namedKeySchema>, string> = {
  enter: "Return",
  tab: "Tab",
  escape: "Escape",
  delete: "BackSpace",
  space: "space",
  arrow_up: "Up",
  arrow_down: "Down",
  arrow_left: "Left",
  arrow_right: "Right",
  page_up: "Page_Up",
  page_down: "Page_Down",
  home: "Home",
  end: "End",
};

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8" }, (error, stdout) =>
      error ? reject(error) : resolve(stdout.trim()),
    );
  });
}

function runAppleScript(script: string, args: string[] = []): Promise<string> {
  return run("/usr/bin/osascript", ["-e", script, "--", ...args]);
}

function platform(ctx: LocalToolCtx): NodeJS.Platform {
  return ctx.platform ?? process.platform;
}

function computerUseEnabled(
  ctx: LocalToolCtx,
  meta: { environment?: "local" | "cloud"; computerUse?: boolean } | undefined,
): boolean {
  if (meta?.computerUse !== true) return false;
  return (
    (platform(ctx) === "darwin" && meta.environment === "local") ||
    (platform(ctx) === "linux" && meta.environment === "cloud")
  );
}

async function resultFrom(
  action: () => Promise<LocalToolResult>,
): Promise<LocalToolResult> {
  try {
    return await action();
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text:
            error instanceof Error
              ? error.message
              : "Computer control failed unexpectedly",
        },
      ],
      isError: true,
    };
  }
}

async function captureScreenshot(ctx: LocalToolCtx): Promise<LocalToolResult> {
  const id = randomUUID();
  const sourcePath = join(tmpdir(), `posthog-computer-${id}.png`);
  const outputPath = join(tmpdir(), `posthog-computer-${id}.jpg`);
  try {
    if (platform(ctx) === "darwin") {
      await run("/usr/sbin/screencapture", ["-x", "-t", "png", sourcePath]);
    } else {
      await run("/usr/bin/import", ["-window", "root", sourcePath]);
    }
    for (const attempt of screenshotCompressionAttempts) {
      if (platform(ctx) === "darwin") {
        await run("/usr/bin/sips", [
          "--resampleHeightWidthMax",
          String(attempt.maxDimension),
          "--setProperty",
          "format",
          "jpeg",
          "--setProperty",
          "formatOptions",
          attempt.quality,
          sourcePath,
          "--out",
          outputPath,
        ]);
      } else {
        await run("/usr/bin/convert", [
          sourcePath,
          "-resize",
          `${attempt.maxDimension}x${attempt.maxDimension}>`,
          "-quality",
          attempt.quality,
          outputPath,
        ]);
      }
      const data = await readFile(outputPath);
      if (data.byteLength <= MAX_SCREENSHOT_BYTES) {
        return {
          content: [
            { type: "text", text: "Captured the current display." },
            {
              type: "image",
              data: data.toString("base64"),
              mimeType: "image/jpeg",
            },
          ],
        };
      }
    }
    throw new Error("Captured screenshot exceeds the 1 MB image limit");
  } finally {
    await Promise.all([
      unlink(sourcePath).catch(() => undefined),
      unlink(outputPath).catch(() => undefined),
    ]);
  }
}

export const computerScreenshotTool = defineLocalTool({
  name: "computer_screenshot",
  description:
    "Capture the current computer display. Use this before clicking and after each action to verify the actual result.",
  schema: {},
  alwaysLoad: true,
  isEnabled: computerUseEnabled,
  handler: async (ctx) => resultFrom(() => captureScreenshot(ctx)),
});

export const computerListApplicationsTool = defineLocalTool({
  name: "computer_list_applications",
  description: "List visible applications on the current computer.",
  schema: {},
  alwaysLoad: true,
  isEnabled: computerUseEnabled,
  handler: async (ctx) =>
    resultFrom(async () => {
      const applications =
        platform(ctx) === "darwin"
          ? await runAppleScript(
              'tell application "System Events" to get name of every application process whose background only is false',
            )
          : await run("/usr/bin/wmctrl", ["-lx"]);
      return {
        content: [
          {
            type: "text",
            text: applications || "No visible applications are running.",
          },
        ],
      };
    }),
});

export const computerOpenApplicationTool = defineLocalTool({
  name: "computer_open_application",
  description:
    "Open or focus an application by name. In cloud tasks, common names include Chrome and Terminal.",
  schema: { application: z.string().trim().min(1).max(120) },
  alwaysLoad: true,
  isEnabled: computerUseEnabled,
  handler: async (ctx, { application }) =>
    resultFrom(async () => {
      if (platform(ctx) === "darwin") {
        await run("/usr/bin/open", ["-a", application]);
        await runAppleScript(
          'on run argv\nset applicationName to item 1 of argv\ntell application "System Events" to set frontmost of process applicationName to true\nend run',
          [application],
        );
      } else {
        const normalized = application.toLowerCase();
        const command =
          normalized.includes("chrome") || normalized.includes("browser")
            ? "/usr/bin/epiphany"
            : normalized.includes("terminal")
              ? "/usr/bin/xterm"
              : "/usr/bin/gtk-launch";
        const args =
          command === "/usr/bin/gtk-launch"
            ? [application]
            : command === "/usr/bin/epiphany"
              ? ["--new-window"]
              : [];
        spawn(command, args, { detached: true, stdio: "ignore" }).unref();
      }
      return { content: [{ type: "text", text: `Opened ${application}.` }] };
    }),
});

export const computerClickTool = defineLocalTool({
  name: "computer_click",
  description:
    "Click an absolute screen coordinate. Take a screenshot before and after the click.",
  schema: {
    x: z.number().int().min(0).max(100_000),
    y: z.number().int().min(0).max(100_000),
  },
  alwaysLoad: true,
  isEnabled: computerUseEnabled,
  handler: async (ctx, { x, y }) =>
    resultFrom(async () => {
      if (platform(ctx) === "darwin")
        await runAppleScript(
          'on run argv\nset clickX to item 1 of argv as integer\nset clickY to item 2 of argv as integer\ntell application "System Events" to click at {clickX, clickY}\nend run',
          [String(x), String(y)],
        );
      else
        await run("/usr/bin/xdotool", [
          "mousemove",
          String(x),
          String(y),
          "click",
          "1",
        ]);
      return { content: [{ type: "text", text: `Clicked ${x}, ${y}.` }] };
    }),
});

export const computerTypeTool = defineLocalTool({
  name: "computer_type",
  description:
    "Type text into the focused control. Never use this for passwords, tokens, recovery codes, or other secrets.",
  schema: { text: z.string().min(1).max(4_000) },
  alwaysLoad: true,
  isEnabled: computerUseEnabled,
  handler: async (ctx, { text }) =>
    resultFrom(async () => {
      if (platform(ctx) === "darwin")
        await runAppleScript(
          'on run argv\ntell application "System Events" to keystroke (item 1 of argv)\nend run',
          [text],
        );
      else await run("/usr/bin/xdotool", ["type", "--delay", "1", "--", text]);
      return {
        content: [{ type: "text", text: `Typed ${text.length} characters.` }],
      };
    }),
});

export const computerKeyTool = defineLocalTool({
  name: "computer_key",
  description:
    "Press a named key or a single letter/number with optional modifiers.",
  schema: {
    key: z.union([namedKeySchema, z.string().regex(/^[a-z0-9]$/i)]),
    modifiers: z.array(modifierSchema).max(4).default([]),
  },
  alwaysLoad: true,
  isEnabled: computerUseEnabled,
  handler: async (ctx, { key, modifiers }) =>
    resultFrom(async () => {
      if (platform(ctx) === "darwin") {
        const modifierList = modifiers.map((modifier) => `${modifier} down`);
        const usingClause =
          modifierList.length > 0 ? ` using {${modifierList.join(", ")}}` : "";
        const script =
          key in macKeyCodes
            ? `tell application "System Events" to key code ${macKeyCodes[key as keyof typeof macKeyCodes]}${usingClause}`
            : `tell application "System Events" to keystroke "${key.toLowerCase()}"${usingClause}`;
        await runAppleScript(script);
      } else {
        const linuxModifiers = modifiers.map(
          (modifier) =>
            ({
              command: "super",
              control: "ctrl",
              option: "alt",
              shift: "shift",
            })[modifier],
        );
        await run("/usr/bin/xdotool", [
          "key",
          [
            ...linuxModifiers,
            linuxKeys[key as keyof typeof linuxKeys] ?? key.toLowerCase(),
          ].join("+"),
        ]);
      }
      return {
        content: [
          { type: "text", text: `Pressed ${[...modifiers, key].join("+")}.` },
        ],
      };
    }),
});

export const computerUseTools: LocalTool[] = [
  computerScreenshotTool,
  computerListApplicationsTool,
  computerOpenApplicationTool,
  computerClickTool,
  computerTypeTool,
  computerKeyTool,
];
