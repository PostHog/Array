import { describe, expect, it, vi } from "vitest";
import { createConversationDiffPoolOptions } from "./conversationDiffPoolOptions";

describe("createConversationDiffPoolOptions", () => {
  it("limits syntax-highlighting workers for diff-heavy conversations", () => {
    const worker = {} as Worker;
    const diffWorkerFactory = vi.fn(() => worker);
    const options = createConversationDiffPoolOptions(diffWorkerFactory);

    expect(options.poolSize).toBe(2);
    expect(options.totalASTLRUCacheSize).toBe(200);
    expect(options.workerFactory()).toBe(worker);
    expect(diffWorkerFactory).toHaveBeenCalledOnce();
  });
});
