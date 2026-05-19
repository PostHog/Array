import { vi } from "vitest";

export function makeLoggerMock() {
  return {
    logger: {
      scope: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }),
    },
  };
}
