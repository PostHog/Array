import { execFile, spawn } from "node:child_process";
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

vi.mock("node:child_process", () => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

const mockedExecFile = vi.mocked(execFile);
const mockedSpawn = vi.mocked(spawn);
const mockedReadFile = vi.mocked(readFile);
const mockedUnlink = vi.mocked(unlink);

const context = { cwd: "/repo", platform: "darwin" as const };
const enabledMeta = { environment: "local" as const, computerUse: true };
const cloudContext = { cwd: "/repo", platform: "linux" as const };
const cloudMeta = { environment: "cloud" as const, computerUse: true };

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
    mockedSpawn.mockReturnValue({ unref: vi.fn() } as never);
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

  it("is enabled for opted-in cloud Linux sessions", () => {
    expect(computerScreenshotTool.isEnabled(cloudContext, cloudMeta)).toBe(
      true,
    );
  });

  it("returns a screenshot image and removes the temporary file", async () => {
    const result = await computerScreenshotTool.handler(context, {});

    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image", mimeType: "image/jpeg" }),
      ]),
    );
    expect(mockedExecFile).toHaveBeenCalledWith(
      "/usr/bin/sips",
      expect.arrayContaining(["--resampleHeightWidthMax", "1600"]),
      { encoding: "utf8" },
      expect.any(Function),
    );
    expect(mockedUnlink).toHaveBeenCalledTimes(2);
  });

  it("retries screenshot compression until the image fits the request budget", async () => {
    mockedReadFile
      .mockResolvedValueOnce(Buffer.alloc(1_000_001))
      .mockResolvedValueOnce(Buffer.from("jpeg"));

    const result = await computerScreenshotTool.handler(context, {});

    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          data: Buffer.from("jpeg").toString("base64"),
        }),
      ]),
    );
    expect(mockedExecFile).toHaveBeenCalledWith(
      "/usr/bin/sips",
      expect.arrayContaining(["--resampleHeightWidthMax", "1200"]),
      { encoding: "utf8" },
      expect.any(Function),
    );
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

  it("opens the cloud browser without invoking a shell", async () => {
    const unref = vi.fn();
    mockedSpawn.mockReturnValueOnce({ unref } as never);

    await computerOpenApplicationTool.handler(cloudContext, {
      application: "Browser",
    });

    expect(mockedSpawn).toHaveBeenCalledWith(
      "/usr/bin/epiphany",
      ["--new-window"],
      { detached: true, stdio: "ignore" },
    );
    expect(unref).toHaveBeenCalledOnce();
  });

  it("uses Linux desktop utilities in cloud sessions", async () => {
    await computerClickTool.handler(cloudContext, { x: 100, y: 200 });

    expect(mockedExecFile).toHaveBeenCalledWith(
      "/usr/bin/xdotool",
      ["mousemove", "100", "200", "click", "1"],
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
