import { afterEach, vi } from "vitest";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      version: "0.0.0-test",
    },
  },
}));

vi.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(async () => {
        store.clear();
      }),
      getAllKeys: vi.fn(async () => Array.from(store.keys())),
      multiGet: vi.fn(async (keys: string[]) =>
        keys.map((key) => [key, store.get(key) ?? null]),
      ),
      multiSet: vi.fn(async (pairs: [string, string][]) => {
        for (const [key, value] of pairs) {
          store.set(key, value);
        }
      }),
      multiRemove: vi.fn(async (keys: string[]) => {
        for (const key of keys) {
          store.delete(key);
        }
      }),
    },
  };
});

vi.mock("phosphor-react-native", async () => {
  const { createElement } = await import("react");
  return new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === "__esModule") return true;
        if (typeof name !== "string") return undefined;
        return (props: Record<string, unknown>) => createElement(name, props);
      },
    },
  );
});

vi.mock("react-native-safe-area-context", async () => {
  const { createElement } = await import("react");
  return {
    SafeAreaProvider: (props: { children?: unknown }) =>
      createElement("SafeAreaProvider", null, props.children as never),
    SafeAreaView: (props: { children?: unknown }) =>
      createElement("SafeAreaView", null, props.children as never),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 375, height: 812 }),
  };
});

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
