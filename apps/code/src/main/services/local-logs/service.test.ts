import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockMkdir, mockWriteFile, mockReadFile, mockRename, mockUnlink } =
  vi.hoisted(() => ({
    mockMkdir: vi.fn(),
    mockWriteFile: vi.fn(),
    mockReadFile: vi.fn(),
    mockRename: vi.fn(),
    mockUnlink: vi.fn(),
  }));

vi.mock("node:fs", () => ({
  default: {
    promises: {
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
      readFile: mockReadFile,
      rename: mockRename,
      unlink: mockUnlink,
    },
  },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { LocalLogsService } from "./service";

const RUN_ID = "run-abc";
const expectedPath = path.join(
  os.homedir(),
  ".posthog-code",
  "sessions",
  RUN_ID,
  "logs.ndjson",
);

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("LocalLogsService", () => {
  beforeEach(() => {
    mockMkdir.mockReset().mockResolvedValue(undefined);
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    mockReadFile.mockReset();
    mockRename.mockReset().mockResolvedValue(undefined);
    mockUnlink.mockReset().mockResolvedValue(undefined);
  });

  describe("readLocalLogs", () => {
    it("returns file contents", async () => {
      mockReadFile.mockResolvedValue("hello");
      const service = new LocalLogsService();
      await expect(service.readLocalLogs(RUN_ID)).resolves.toBe("hello");
      expect(mockReadFile).toHaveBeenCalledWith(expectedPath, "utf-8");
    });

    it.each([
      ["file is missing", Object.assign(new Error("nope"), { code: "ENOENT" })],
      ["other read errors", new Error("boom")],
    ])("returns null when %s", async (_label, err) => {
      mockReadFile.mockRejectedValue(err);
      const service = new LocalLogsService();
      await expect(service.readLocalLogs(RUN_ID)).resolves.toBeNull();
    });
  });

  describe("writeLocalLogs", () => {
    it("writes content to the run's NDJSON path", async () => {
      const service = new LocalLogsService();
      await service.writeLocalLogs(RUN_ID, "line1\n");
      expect(mockMkdir).toHaveBeenCalledWith(path.dirname(expectedPath), {
        recursive: true,
      });
      expect(mockWriteFile).toHaveBeenCalledWith(
        expectedPath,
        "line1\n",
        "utf-8",
      );
    });

    it("collapses many concurrent writes to one in-flight + one queued", async () => {
      const firstWrite = deferred();
      mockWriteFile.mockImplementationOnce(() => firstWrite.promise);

      const service = new LocalLogsService();

      const a = service.writeLocalLogs(RUN_ID, "A");
      const b = service.writeLocalLogs(RUN_ID, "B");
      const c = service.writeLocalLogs(RUN_ID, "C");
      const d = service.writeLocalLogs(RUN_ID, "D");

      await flushMicrotasks();
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mockWriteFile).toHaveBeenCalledWith(expectedPath, "A", "utf-8");

      firstWrite.resolve();
      await Promise.all([a, b, c, d]);

      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      expect(mockWriteFile).toHaveBeenNthCalledWith(
        2,
        expectedPath,
        "D",
        "utf-8",
      );
    });

    it("all coalesced callers see resolution when drain completes", async () => {
      const firstWrite = deferred();
      mockWriteFile.mockImplementationOnce(() => firstWrite.promise);

      const service = new LocalLogsService();
      const a = service.writeLocalLogs(RUN_ID, "A");
      const b = service.writeLocalLogs(RUN_ID, "B");

      let aResolved = false;
      let bResolved = false;
      void a.then(() => {
        aResolved = true;
      });
      void b.then(() => {
        bResolved = true;
      });

      await Promise.resolve();
      expect(aResolved).toBe(false);
      expect(bResolved).toBe(false);

      firstWrite.resolve();
      await Promise.all([a, b]);
      expect(aResolved).toBe(true);
      expect(bResolved).toBe(true);
    });

    it("keeps writes for different taskRunIds independent", async () => {
      const writeA = deferred();
      const writeB = deferred();
      mockWriteFile
        .mockImplementationOnce(() => writeA.promise)
        .mockImplementationOnce(() => writeB.promise);

      const service = new LocalLogsService();
      const a = service.writeLocalLogs("run-a", "AAA");
      const b = service.writeLocalLogs("run-b", "BBB");

      await flushMicrotasks();
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      writeA.resolve();
      writeB.resolve();
      await Promise.all([a, b]);
    });

    it("starts fresh after the queue drains", async () => {
      const service = new LocalLogsService();
      await service.writeLocalLogs(RUN_ID, "first");
      await service.writeLocalLogs(RUN_ID, "second");
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      expect(mockWriteFile).toHaveBeenNthCalledWith(
        2,
        expectedPath,
        "second",
        "utf-8",
      );
    });

    it("continues draining queued content even if a write rejects", async () => {
      const firstWrite = deferred();
      mockWriteFile.mockImplementationOnce(() => firstWrite.promise);

      const service = new LocalLogsService();
      const a = service.writeLocalLogs(RUN_ID, "A");
      const b = service.writeLocalLogs(RUN_ID, "B");

      firstWrite.reject(new Error("disk full"));
      await Promise.all([a, b]);

      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      expect(mockWriteFile).toHaveBeenNthCalledWith(
        2,
        expectedPath,
        "B",
        "utf-8",
      );
    });

    it("skips writeFile when coalesced content matches the last write", async () => {
      const firstWrite = deferred();
      mockWriteFile.mockImplementationOnce(() => firstWrite.promise);

      const service = new LocalLogsService();
      const a = service.writeLocalLogs(RUN_ID, "SAME");
      const b = service.writeLocalLogs(RUN_ID, "SAME");

      firstWrite.resolve();
      await Promise.all([a, b]);

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
    });

    it("only mkdirs once per drain", async () => {
      const firstWrite = deferred();
      mockWriteFile.mockImplementationOnce(() => firstWrite.promise);

      const service = new LocalLogsService();
      const a = service.writeLocalLogs(RUN_ID, "A");
      const b = service.writeLocalLogs(RUN_ID, "B");

      firstWrite.resolve();
      await Promise.all([a, b]);

      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      expect(mockMkdir).toHaveBeenCalledTimes(1);
    });
  });

  describe("truncateLocalLogsAtPromptBoundary", () => {
    // A boundary line is the JSON-RPC response to a session/prompt request:
    // type "notification" with a matching notification.id and a result field.
    const responseLine = (id: number) =>
      JSON.stringify({
        type: "notification",
        notification: { id, result: {} },
      });

    it("truncates to the prompt boundary and returns true", async () => {
      const kept = `${[responseLine(2), responseLine(3)].join("\n")}\n`;
      mockReadFile.mockResolvedValue(
        `${[responseLine(2), responseLine(3), responseLine(4)].join("\n")}\n`,
      );

      const service = new LocalLogsService();
      const result = await service.truncateLocalLogsAtPromptBoundary(RUN_ID, 3);

      expect(result).toBe(true);
      // Atomic write: tmp file written then renamed over the real path.
      expect(mockRename).toHaveBeenCalledTimes(1);
      const wroteTruncated = mockWriteFile.mock.calls.some(
        (call) => call[1] === kept,
      );
      expect(wroteTruncated).toBe(true);
      await flushMicrotasks();
    });

    it("returns false and does not rewrite when the boundary is not found", async () => {
      mockReadFile.mockResolvedValue(
        `${[responseLine(2), responseLine(3)].join("\n")}\n`,
      );

      const service = new LocalLogsService();
      const result = await service.truncateLocalLogsAtPromptBoundary(
        RUN_ID,
        99,
      );

      expect(result).toBe(false);
      expect(mockRename).not.toHaveBeenCalled();
    });

    it("returns true without rewriting when the boundary is already last", async () => {
      mockReadFile.mockResolvedValue(
        `${[responseLine(2), responseLine(3)].join("\n")}\n`,
      );

      const service = new LocalLogsService();
      const result = await service.truncateLocalLogsAtPromptBoundary(RUN_ID, 3);

      expect(result).toBe(true);
      expect(mockRename).not.toHaveBeenCalled();
    });

    it("returns true when the log file does not exist", async () => {
      mockReadFile.mockRejectedValue(
        Object.assign(new Error("nope"), { code: "ENOENT" }),
      );

      const service = new LocalLogsService();
      const result = await service.truncateLocalLogsAtPromptBoundary(RUN_ID, 3);

      expect(result).toBe(true);
      expect(mockRename).not.toHaveBeenCalled();
    });

    it("returns false on a non-ENOENT read error", async () => {
      mockReadFile.mockRejectedValue(new Error("boom"));

      const service = new LocalLogsService();
      const result = await service.truncateLocalLogsAtPromptBoundary(RUN_ID, 3);

      expect(result).toBe(false);
    });
  });
});
