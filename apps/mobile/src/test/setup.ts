import { afterEach, vi } from "vitest";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      version: "0.0.0-test",
    },
  },
}));

vi.mock("react-native", async () => {
  const actual = await import("react-native-web");
  const { createElement } = await import("react");

  return {
    ...actual,
    Alert: {
      alert: vi.fn(),
    },
    BackHandler: {
      addEventListener: vi.fn(() => ({
        remove: vi.fn(),
      })),
    },
    InteractionManager: {
      runAfterInteractions: (callback: () => void) => {
        callback();
        return {
          cancel: vi.fn(),
        };
      },
    },
    Platform: {
      OS: "ios",
      select: <T>(options: { ios?: T; android?: T; default?: T }) =>
        options.ios ?? options.default,
    },
    TextInput: (props: Record<string, unknown>) =>
      createElement("TextInput", props),
  };
});

vi.mock("@/lib/logger", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    scope: () => mockLogger,
  };

  return {
    logger: mockLogger,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});
