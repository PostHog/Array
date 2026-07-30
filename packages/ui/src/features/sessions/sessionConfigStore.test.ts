import {
  flushRendererStateWrites,
  registerRendererStateStorage,
} from "@posthog/ui/shell/rendererStorage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPersistedAlwaysOnSkills,
  removePersistedAlwaysOnSkills,
  setPersistedAlwaysOnSkills,
  useSessionConfigStore,
} from "./sessionConfigStore";

const getItem = vi.fn();
const setItem = vi.fn();
const removeItem = vi.fn();

registerRendererStateStorage({ getItem, setItem, removeItem });

describe("sessionConfigStore always-on skills", () => {
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
      alwaysOnSkillsByRunId: {},
    });
  });

  it("persists skill references by task run until they are removed", async () => {
    const skills = [{ name: "test", source: "user" as const, path: "/test" }];
    setPersistedAlwaysOnSkills("run-1", skills);

    expect(getPersistedAlwaysOnSkills("run-1")).toEqual(skills);
    await flushRendererStateWrites();
    expect(setItem).toHaveBeenCalledWith(
      "session-config-storage",
      expect.stringContaining('"name":"test"'),
    );

    removePersistedAlwaysOnSkills("run-1");
    expect(getPersistedAlwaysOnSkills("run-1")).toBeUndefined();
  });
});
