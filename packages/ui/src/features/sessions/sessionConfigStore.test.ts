import {
  flushRendererStateWrites,
  registerRendererStateStorage,
} from "@posthog/ui/shell/rendererStorage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPersistedAlwaysOnSkillInstructions,
  removePersistedAlwaysOnSkillInstructions,
  setPersistedAlwaysOnSkillInstructions,
  useSessionConfigStore,
} from "./sessionConfigStore";

const getItem = vi.fn();
const setItem = vi.fn();
const removeItem = vi.fn();

registerRendererStateStorage({ getItem, setItem, removeItem });

describe("sessionConfigStore always-on skill instructions", () => {
  beforeEach(async () => {
    await flushRendererStateWrites();
    getItem.mockReset();
    setItem.mockReset();
    removeItem.mockReset();
    getItem.mockResolvedValue(null);
    setItem.mockResolvedValue(undefined);
    removeItem.mockResolvedValue(undefined);
    useSessionConfigStore.setState({
      configsByRunId: {},
      alwaysOnSkillInstructionsByRunId: {},
    });
  });

  it("persists instructions by task run until they are removed", async () => {
    setPersistedAlwaysOnSkillInstructions("run-1", "Follow this skill");

    expect(getPersistedAlwaysOnSkillInstructions("run-1")).toBe(
      "Follow this skill",
    );
    await flushRendererStateWrites();
    expect(setItem).toHaveBeenCalledWith(
      "session-config-storage",
      expect.stringContaining("Follow this skill"),
    );

    removePersistedAlwaysOnSkillInstructions("run-1");
    expect(getPersistedAlwaysOnSkillInstructions("run-1")).toBeUndefined();
  });
});
