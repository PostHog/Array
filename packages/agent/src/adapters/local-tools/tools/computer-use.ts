import { execFile } from "node:child_process";
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
const MAX_SCREENSHOT_BYTES = 1_000_000;
const screenshotCompressionAttempts = [
  { maxDimension: 1600, quality: "75" },
  { maxDimension: 1200, quality: "60" },
  { maxDimension: 900, quality: "45" },
] as const;
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

const keyCodes: Record<z.infer<typeof namedKeySchema>, number> = {
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

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function runAppleScript(script: string, args: string[] = []): Promise<string> {
  return run("/usr/bin/osascript", ["-e", script, "--", ...args]);
}

function computerUseEnabled(
  ctx: LocalToolCtx,
  meta: { environment?: "local" | "cloud"; computerUse?: boolean } | undefined,
): boolean {
  return (
    (ctx.platform ?? process.platform) === "darwin" &&
    meta?.environment === "local" &&
    meta.computerUse === true
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

export const computerScreenshotTool = defineLocalTool({
  name: "computer_screenshot",
  description:
    "Capture the user's current macOS display. Use this before clicking and after each action to verify the actual result. Requires Screen Recording permission for PostHog Code.",
  schema: {},
  alwaysLoad: true,
  isEnabled: computerUseEnabled,
  handler: async () =>
    resultFrom(async () => {
      const id = randomUUID();
      const sourcePath = join(tmpdir(), `posthog-computer-${id}.png`);
      const outputPath = join(tmpdir(), `posthog-computer-${id}.jpg`);
      try {
        await run("/usr/sbin/screencapture", ["-x", "-t", "png", sourcePath]);
        for (const attempt of screenshotCompressionAttempts) {
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
    }),
});

export const computerListApplicationsTool = defineLocalTool({
  name: "computer_list_applications",
  description:
    "List visible applications currently running on the user's Mac. Use this before focusing or opening an application when its exact name is uncertain.",
  schema: {},
  alwaysLoad: true,
  isEnabled: computerUseEnabled,
  handler: async () =>
    resultFrom(async () => {
      const applications = await runAppleScript(
        'tell application "System Events" to get name of every application process whose background only is false',
      );
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
    "Open or focus a macOS application by its display name, for example Safari, Slack, or Notes. Verify the result with computer_screenshot.",
  schema: {
    application: z.string().trim().min(1).max(120),
  },
  alwaysLoad: true,
  isEnabled: computerUseEnabled,
  handler: async (_ctx, { application }) =>
    resultFrom(async () => {
      await run("/usr/bin/open", ["-a", application]);
      await runAppleScript(
        'on run argv\nset applicationName to item 1 of argv\ntell application "System Events" to set frontmost of process applicationName to true\nend run',
        [application],
      );
      return {
        content: [{ type: "text", text: `Opened ${application}.` }],
      };
    }),
});

export const computerClickTool = defineLocalTool({
  name: "computer_click",
  description:
    "Click an absolute screen coordinate on the user's Mac. Take a screenshot first, click the center of the intended control, then take another screenshot. Requires Accessibility permission for PostHog Code.",
  schema: {
    x: z.number().int().min(0).max(100_000),
    y: z.number().int().min(0).max(100_000),
  },
  alwaysLoad: true,
  isEnabled: computerUseEnabled,
  handler: async (_ctx, { x, y }) =>
    resultFrom(async () => {
      await runAppleScript(
        'on run argv\nset clickX to item 1 of argv as integer\nset clickY to item 2 of argv as integer\ntell application "System Events" to click at {clickX, clickY}\nend run',
        [String(x), String(y)],
      );
      return { content: [{ type: "text", text: `Clicked ${x}, ${y}.` }] };
    }),
});

export const computerTypeTool = defineLocalTool({
  name: "computer_type",
  description:
    "Type text into the currently focused macOS control. Click the target field first and never use this for passwords, tokens, recovery codes, or other secrets. Requires Accessibility permission for PostHog Code.",
  schema: {
    text: z.string().min(1).max(4_000),
  },
  alwaysLoad: true,
  isEnabled: computerUseEnabled,
  handler: async (_ctx, { text }) =>
    resultFrom(async () => {
      await runAppleScript(
        'on run argv\ntell application "System Events" to keystroke (item 1 of argv)\nend run',
        [text],
      );
      return {
        content: [{ type: "text", text: `Typed ${text.length} characters.` }],
      };
    }),
});

export const computerKeyTool = defineLocalTool({
  name: "computer_key",
  description:
    "Press a named key or a single letter/number with optional modifiers on the user's Mac, for example command+l or enter. Requires Accessibility permission for PostHog Code.",
  schema: {
    key: z.union([namedKeySchema, z.string().regex(/^[a-z0-9]$/i)]),
    modifiers: z.array(modifierSchema).max(4).default([]),
  },
  alwaysLoad: true,
  isEnabled: computerUseEnabled,
  handler: async (_ctx, { key, modifiers }) =>
    resultFrom(async () => {
      const modifierList = modifiers.map((modifier) => `${modifier} down`);
      const usingClause =
        modifierList.length > 0 ? ` using {${modifierList.join(", ")}}` : "";
      const script =
        key in keyCodes
          ? `tell application "System Events" to key code ${keyCodes[key as keyof typeof keyCodes]}${usingClause}`
          : `tell application "System Events" to keystroke "${key.toLowerCase()}"${usingClause}`;
      await runAppleScript(script);
      return {
        content: [
          {
            type: "text",
            text: `Pressed ${[...modifiers, key].join("+")}.`,
          },
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
