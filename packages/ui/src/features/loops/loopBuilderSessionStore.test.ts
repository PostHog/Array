import { beforeEach, expect, it, vi } from "vitest";
import {
  type LoopBuilderSession,
  MAX_BUILDER_SESSIONS,
  useLoopBuilderSessionStore,
} from "./loopBuilderSessionStore";

vi.mock("@posthog/ui/shell/rendererStorage", () => ({
  electronStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
  flushRendererStateWrites: async () => {},
}));

function session(taskId: string, startedAt = 0): LoopBuilderSession {
  return { taskId, prompt: `prompt ${taskId}`, startedAt };
}

beforeEach(() => {
  useLoopBuilderSessionStore.setState({ sessions: [] });
});

it("adds sessions newest first", () => {
  const store = useLoopBuilderSessionStore.getState();
  store.addSession(session("a", 1));
  store.addSession(session("b", 2));
  expect(
    useLoopBuilderSessionStore.getState().sessions.map((s) => s.taskId),
  ).toEqual(["b", "a"]);
});

it("replaces an existing session with the same task id", () => {
  const store = useLoopBuilderSessionStore.getState();
  store.addSession(session("a", 1));
  store.addSession(session("b", 2));
  store.addSession({ taskId: "a", prompt: "updated", startedAt: 3 });
  const sessions = useLoopBuilderSessionStore.getState().sessions;
  expect(sessions.map((s) => s.taskId)).toEqual(["a", "b"]);
  expect(sessions[0]?.prompt).toBe("updated");
});

it("caps the list at the max session count", () => {
  const store = useLoopBuilderSessionStore.getState();
  for (let i = 0; i < MAX_BUILDER_SESSIONS + 2; i++) {
    store.addSession(session(`task-${i}`, i));
  }
  const sessions = useLoopBuilderSessionStore.getState().sessions;
  expect(sessions).toHaveLength(MAX_BUILDER_SESSIONS);
  expect(sessions[0]?.taskId).toBe(`task-${MAX_BUILDER_SESSIONS + 1}`);
});

it.each([
  { remove: "a", remaining: ["b"] },
  { remove: "b", remaining: ["a"] },
  { remove: "missing", remaining: ["b", "a"] },
])("removing $remove leaves $remaining", ({ remove, remaining }) => {
  const store = useLoopBuilderSessionStore.getState();
  store.addSession(session("a", 1));
  store.addSession(session("b", 2));
  store.removeSession(remove);
  expect(
    useLoopBuilderSessionStore.getState().sessions.map((s) => s.taskId),
  ).toEqual(remaining);
});
