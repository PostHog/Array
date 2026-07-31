import { beforeEach, describe, expect, it } from "vitest";
import { useAlwaysOnSkillsFailureStore } from "./alwaysOnSkillsFailureStore";

describe("alwaysOnSkillsFailureStore", () => {
  beforeEach(() => {
    useAlwaysOnSkillsFailureStore.setState({
      isOpen: false,
      error: null,
      skills: [],
      resolve: null,
    });
  });

  it.each(["retry", "continue", "disable", "cancel"] as const)(
    "resolves the %s recovery action",
    async (action) => {
      const skill = {
        name: "example",
        source: "user" as const,
        path: "/skills/example",
        order: 0,
      };
      const result = useAlwaysOnSkillsFailureStore
        .getState()
        .confirm("missing", [skill]);

      useAlwaysOnSkillsFailureStore.getState().choose(action);

      await expect(result).resolves.toBe(action);
      expect(useAlwaysOnSkillsFailureStore.getState().isOpen).toBe(false);
    },
  );
});
