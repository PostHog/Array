import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODE_COMMANDS,
  rewriteLocalSkillCommandPrompt,
  tryExecuteCodeCommand,
} from "./commands";
import type { EditorAvailableCommand } from "./types";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: toastError, success: vi.fn() },
}));

const commands: EditorAvailableCommand[] = [
  {
    name: "local-test-skill",
    description: "Local user skill",
    localSkill: {
      name: "local-test-skill",
      source: "user",
      path: "/Users/example/.claude/skills/local-test-skill",
    },
  },
];

describe("message editor commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rewrites local skill slash commands to skill tags", () => {
    expect(rewriteLocalSkillCommandPrompt("/local-test-skill", commands)).toBe(
      '<skill name="local-test-skill" source="user" path="/Users/example/.claude/skills/local-test-skill" />',
    );
  });

  it("preserves local skill arguments after the skill tag", () => {
    expect(
      rewriteLocalSkillCommandPrompt(
        "/local-test-skill with context",
        commands,
      ),
    ).toBe(
      '<skill name="local-test-skill" source="user" path="/Users/example/.claude/skills/local-test-skill" /> with context',
    );
  });

  it("does not rewrite unknown commands", () => {
    expect(
      rewriteLocalSkillCommandPrompt("/feedback looks good", commands),
    ).toBe(null);
  });

  it("exposes /new as a built-in code command", () => {
    expect(CODE_COMMANDS.some((cmd) => cmd.name === "new")).toBe(true);
  });

  it("runs /new via onNewSession for local chats", async () => {
    const onNewSession = vi.fn().mockResolvedValue(undefined);
    const handled = await tryExecuteCodeCommand("/new", {
      taskId: "task-1",
      repoPath: "/repo",
      session: null,
      taskRun: null,
      onNewSession,
    });
    expect(handled).toBe(true);
    expect(onNewSession).toHaveBeenCalledOnce();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("rejects /new when no local session is available", async () => {
    const handled = await tryExecuteCodeCommand("/new", {
      taskId: "task-1",
      repoPath: null,
      session: null,
      taskRun: null,
    });
    expect(handled).toBe(true);
    expect(toastError).toHaveBeenCalledWith(
      "Clearing chat is only available for local chats.",
    );
  });
});
