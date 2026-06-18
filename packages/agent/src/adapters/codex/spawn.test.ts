import { describe, expect, it, vi } from "vitest";
import { Logger } from "../../utils/logger";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const { spawnCodexProcess } = await import("./spawn");

function makeFakeChild() {
  return {
    stdin: { destroy: vi.fn() },
    stdout: { on: vi.fn(), destroy: vi.fn() },
    stderr: { on: vi.fn(), destroy: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    pid: 1234,
  };
}

describe("spawnCodexProcess MCP disable args", () => {
  it("disables bare-key servers but skips names codex's -c parser cannot express", () => {
    spawnMock.mockReturnValue(makeFakeChild());

    spawnCodexProcess({
      logger: new Logger({ debug: false }),
      settings: {
        mcpServerNames: ["simple", "with-dash", "my.server", "weird name"],
      },
    });

    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args).toContain("mcp_servers.simple.enabled=false");
    expect(args).toContain("mcp_servers.with-dash.enabled=false");
    // A dotted or otherwise non-bare name would emit an override codex rejects,
    // which crashes the whole session, so it is skipped (the server stays
    // enabled, which is harmless).
    expect(args.some((arg) => arg.includes("my.server"))).toBe(false);
    expect(args.some((arg) => arg.includes("weird name"))).toBe(false);
  });
});

describe("spawnCodexProcess developer instructions", () => {
  it("passes guidance via developer_instructions to preserve the base prompt", () => {
    spawnMock.mockClear();
    spawnMock.mockReturnValue(makeFakeChild());

    spawnCodexProcess({
      logger: new Logger({ debug: false }),
      developerInstructions: "Follow PostHog signed-commit rules.",
    });

    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args).toContain(
      'developer_instructions="Follow PostHog signed-commit rules."',
    );
    // The bare `instructions` and `model_instructions_file` keys replace Codex's
    // model-optimized base prompt, so guidance must never go through them.
    expect(args.some((arg) => arg.startsWith("instructions="))).toBe(false);
    expect(args.some((arg) => arg.startsWith("model_instructions_file="))).toBe(
      false,
    );
  });

  it("escapes backslashes, newlines and quotes in developer_instructions", () => {
    spawnMock.mockClear();
    spawnMock.mockReturnValue(makeFakeChild());

    spawnCodexProcess({
      logger: new Logger({ debug: false }),
      developerInstructions: 'a\\b\n"c',
    });

    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args).toContain('developer_instructions="a\\\\b\\n\\"c"');
  });
});
