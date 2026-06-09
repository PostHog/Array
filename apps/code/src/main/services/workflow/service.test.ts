import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  type SaveInput,
  type WorkflowConfig,
  WorkflowEvent,
} from "@shared/types/workflow";
import type { AuthService } from "../auth/service";
import { WorkflowService } from "./service";

const BINDINGS = {
  working: [],
  in_review: [],
  ci_failing: [],
  changes_requested: [],
  comments_waiting: [],
  ready_to_merge: [],
  stale: [],
  done: [],
};

const CONFIG: WorkflowConfig = {
  id: "wf_1",
  version: 2,
  updatedAt: "2026-01-01T00:00:00Z",
  bindings: BINDINGS,
};

const SAVE_INPUT: SaveInput = {
  config: { id: "wf_1", version: 2, bindings: BINDINGS },
  expectedVersion: 2,
};

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = vi.fn();
const authService = {
  authenticatedProjectFetch: fetchMock,
} as unknown as AuthService;

let service: WorkflowService;
let changed: WorkflowConfig[];

beforeEach(() => {
  fetchMock.mockReset();
  changed = [];
  service = new WorkflowService(authService);
  service.on(WorkflowEvent.Changed, (c) => changed.push(c));
});

describe("WorkflowService.get", () => {
  it("returns the parsed config", async () => {
    fetchMock.mockResolvedValue(res(200, CONFIG));
    await expect(service.get()).resolves.toEqual(CONFIG);
    expect(fetchMock).toHaveBeenCalledWith("code_workflow/", { method: "GET" });
  });

  it("throws on a 500 response", async () => {
    fetchMock.mockResolvedValue(res(500, {}));
    await expect(service.get()).rejects.toThrow("Workflow request failed: 500");
  });
});

describe("WorkflowService.save", () => {
  it("emits Changed and returns the config on a saved result", async () => {
    fetchMock.mockResolvedValue(res(200, { status: "saved", config: CONFIG }));
    await expect(service.save(SAVE_INPUT)).resolves.toEqual({
      status: "saved",
      config: CONFIG,
    });
    expect(changed).toEqual([CONFIG]);
  });

  it("sends the config and expectedVersion as a JSON POST body", async () => {
    fetchMock.mockResolvedValue(res(200, { status: "saved", config: CONFIG }));
    await service.save(SAVE_INPUT);
    expect(fetchMock).toHaveBeenCalledWith("code_workflow/save/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: SAVE_INPUT.config,
        expectedVersion: SAVE_INPUT.expectedVersion,
      }),
    });
  });

  it("does not emit on a 409 conflict that omits config", async () => {
    fetchMock.mockResolvedValue(res(409, { status: "conflict" }));
    await expect(service.save(SAVE_INPUT)).resolves.toEqual({
      status: "conflict",
    });
    expect(changed).toEqual([]);
  });

  it("does not emit on a 422 invalid result and surfaces diagnostics", async () => {
    const diagnostics = [
      { severity: "error", code: "action_empty_prompt", message: "empty" },
    ];
    fetchMock.mockResolvedValue(res(422, { status: "invalid", diagnostics }));
    await expect(service.save(SAVE_INPUT)).resolves.toEqual({
      status: "invalid",
      diagnostics,
    });
    expect(changed).toEqual([]);
  });
});

describe("WorkflowService.resetToDefault", () => {
  it("emits Changed and returns the config", async () => {
    fetchMock.mockResolvedValue(res(200, CONFIG));
    await expect(service.resetToDefault()).resolves.toEqual(CONFIG);
    expect(changed).toEqual([CONFIG]);
    expect(fetchMock).toHaveBeenCalledWith("code_workflow/reset/", {
      method: "POST",
    });
  });

  it("throws on a non-ok response", async () => {
    fetchMock.mockResolvedValue(res(500, {}));
    await expect(service.resetToDefault()).rejects.toThrow(
      "Workflow request failed: 500",
    );
  });
});
