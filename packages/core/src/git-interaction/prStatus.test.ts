import { describe, expect, it } from "vitest";
import { getPrVisualConfig } from "./prStatus";

describe("getPrVisualConfig", () => {
  it.each([["closed", true, false, "Merged", "purple", "merged"]] as const)(
    "maps %s PRs to the expected lifecycle visual",
    (state, merged, draft, label, color, icon) => {
      expect(getPrVisualConfig(state, merged, draft)).toMatchObject({
        label,
        color,
        icon,
      });
    },
  );
});
