import { create } from "zustand";

interface BrowserViewState {
  url: string;
  title: string;
  favicon: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface BrowserStoreState {
  browsers: Record<string, BrowserViewState>;
  setBrowserState: (
    browserId: string,
    state: Partial<BrowserViewState>,
  ) => void;
  removeBrowser: (browserId: string) => void;
}

const defaultBrowserState = (): BrowserViewState => ({
  url: "",
  title: "New Tab",
  favicon: null,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
});

export const useBrowserStore = create<BrowserStoreState>((set) => ({
  browsers: {},

  setBrowserState: (browserId, state) =>
    set((s) => ({
      browsers: {
        ...s.browsers,
        [browserId]: {
          ...(s.browsers[browserId] ?? defaultBrowserState()),
          ...state,
        },
      },
    })),

  removeBrowser: (browserId) =>
    set((s) => {
      const { [browserId]: _, ...rest } = s.browsers;
      return { browsers: rest };
    }),
}));

export function useBrowserViewState(browserId: string): BrowserViewState {
  return useBrowserStore((s) => s.browsers[browserId] ?? defaultBrowserState());
}
