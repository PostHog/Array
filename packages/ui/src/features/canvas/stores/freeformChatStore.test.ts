import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_FREEFORM_THREAD,
  useFreeformChatStore,
} from "./freeformChatStore";

vi.mock("../hostClient", () => ({
  hostClient: () => ({
    dashboards: { saveFreeform: { mutate: vi.fn().mockResolvedValue({}) } },
  }),
}));

const THREAD = "dashboard:d1";

const version = (id: string, code: string) => ({
  id,
  code,
  context: "",
  createdAt: 0,
});

const thread = () =>
  useFreeformChatStore.getState().threads[THREAD] ?? EMPTY_FREEFORM_THREAD;

beforeEach(() => {
  useFreeformChatStore.setState({ threads: {}, threadOrder: [] });
});

// `hasRendered` is what separates "errored with nothing on screen" — the blank
// canvas — from "errored after rendering", where the canvas is still visible and
// a toolbar notice is enough.
describe("freeformChatStore render health", () => {
  it("starts out as not-yet-rendered with no error", () => {
    expect(thread().hasRendered).toBe(false);
    expect(thread().runtimeError).toBeNull();
  });

  it("clears the error and records the render when the sandbox commits one", () => {
    const { setRuntimeError, markRendered } = useFreeformChatStore.getState();

    setRuntimeError(THREAD, "boom");
    expect(thread().runtimeError).toBe("boom");

    markRendered(THREAD);
    expect(thread().runtimeError).toBeNull();
    expect(thread().hasRendered).toBe(true);
  });

  it("keeps an error raised after a successful render", () => {
    const { markRendered, setRuntimeError } = useFreeformChatStore.getState();

    markRendered(THREAD);
    setRuntimeError(THREAD, "a later data failure");

    expect(thread().hasRendered).toBe(true);
    expect(thread().runtimeError).toBe("a later data failure");
  });

  it("resets render health when a record seeds new code", () => {
    const { markRendered, syncFromRecord } = useFreeformChatStore.getState();

    markRendered(THREAD);
    syncFromRecord(THREAD, { code: "export default () => null" });

    expect(thread().code).toBe("export default () => null");
    expect(thread().hasRendered).toBe(false);
  });

  it.each([
    {
      name: "undo",
      // Starts on the head version, so undo has somewhere to go.
      startOnOlderVersion: false,
      act: () => useFreeformChatStore.getState().undo(THREAD),
    },
    {
      name: "redo",
      startOnOlderVersion: true,
      act: () => useFreeformChatStore.getState().redo(THREAD),
    },
    {
      name: "goToLatest",
      startOnOlderVersion: true,
      act: () => useFreeformChatStore.getState().goToLatest(THREAD),
    },
  ])(
    "resets render health when $name swaps the live code",
    ({ startOnOlderVersion, act }) => {
      const { syncFromRecord, markRendered, undo } =
        useFreeformChatStore.getState();
      syncFromRecord(THREAD, {
        code: "v2",
        versions: [version("a", "v1"), version("b", "v2")],
        currentVersionId: "b",
      });
      if (startOnOlderVersion) undo(THREAD);
      markRendered(THREAD);

      act();

      expect(thread().hasRendered).toBe(false);
    },
  );
});
