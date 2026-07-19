import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computerClickTool,
  computerKeyTool,
  computerOpenApplicationTool,
  computerScreenshotTool,
  computerTypeTool,
  computerUseTools,
} from "./computer-use";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

const mockedExecFile = vi.mocked(execFile);
const mockedReadFile = vi.mocked(readFile);
const mockedUnlink = vi.mocked(unlink);

const context = { cwd: "/repo", platform: "darwin" as const };
const enabledMeta = { environment: "local" as const, computerUse: true };

describe("computer use tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExecFile.mockImplementation(((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback === "function") {
        callback(null, "", "");
      }
      return undefined;
    }) as unknown as typeof execFile);
    mockedReadFile.mockResolvedValue(Buffer.from("png"));
    mockedUnlink.mockResolvedValue(undefined);
  });

  it("registers unique computer tool names", () => {
    const names = computerUseTools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each([
    {
      platform: "linux" as const,
      environment: "local" as const,
      enabled: true,
    },
    {
      platform: "darwin" as const,
      environment: "cloud" as const,
      enabled: true,
    },
    {
      platform: "darwin" as const,
      environment: "local" as const,
      enabled: false,
    },
  ])("stays hidden for unsupported context %#", (input) => {
    expect(
      computerScreenshotTool.isEnabled(
        { cwd: "/repo", platform: input.platform },
        { environment: input.environment, computerUse: input.enabled },
      ),
    ).toBe(false);
  });

  it("is enabled for opted-in local macOS sessions", () => {
    expect(computerScreenshotTool.isEnabled(context, enabledMeta)).toBe(true);
  });

  it("returns a screenshot image and removes the temporary file", async () => {
    const result = await computerScreenshotTool.handler(context, {});

    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image", mimeType: "image/png" }),
      ]),
    );
    expect(mockedUnlink).toHaveBeenCalledOnce();
  });

  it("opens applications without invoking a shell", async () => {
    await computerOpenApplicationTool.handler(context, {
      application: "Notes",
    });

    expect(mockedExecFile).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-a", "Notes"],
      { encoding: "utf8" },
      expect.any(Function),
    );
    expect(mockedExecFile).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      expect.any(Array),
      { encoding: "utf8" },
      expect.any(Function),
    );
  });

  it.each([
    [computerClickTool, { x: 100, y: 200 }],
    [computerTypeTool, { text: "hello" }],
    [computerKeyTool, { key: "l", modifiers: ["command"] }],
  ] as const)("uses osascript for %s", async (tool, args) => {
    await tool.handler(context, args);

    expect(mockedExecFile).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      expect.any(Array),
      { encoding: "utf8" },
      expect.any(Function),
    );
  });
});
