import { create } from 'zustand';

interface KeyHint {
  keys: string[];
  description: string;
}

interface StatusBarState {
  statusText: string;
  keyHints: KeyHint[];
  mode: 'replace' | 'append';
}

interface StatusBarStore {
  statusText: string;
  keyHints: KeyHint[];
  mode: 'replace' | 'append';

  setStatus: (text: string) => void;
  setKeyHints: (hints: KeyHint[], mode?: 'replace' | 'append') => void;
  setStatusBar: (config: Partial<StatusBarState>) => void;
  reset: () => void;
}

const defaultKeyHints: KeyHint[] = [
  {
    keys: [navigator.platform.includes('Mac') ? '⌘' : 'Ctrl', 'K'],
    description: 'Command'
  },
  {
    keys: [navigator.platform.includes('Mac') ? '⌘' : 'Ctrl', 'R'],
    description: 'Refresh'
  }
];

export const useStatusBarStore = create<StatusBarStore>((set, get) => ({
  statusText: 'Ready',
  keyHints: defaultKeyHints,
  mode: 'replace',

  setStatus: (text) => {
    set({ statusText: text });
  },

  setKeyHints: (hints, mode = 'replace') => {
    if (mode === 'append') {
      set({
        keyHints: [...defaultKeyHints, ...hints],
        mode
      });
    } else {
      set({
        keyHints: hints,
        mode
      });
    }
  },

  setStatusBar: (config) => {
    const newState: Partial<StatusBarState> = { ...config };

    if (config.keyHints && config.mode === 'append') {
      newState.keyHints = [...defaultKeyHints, ...config.keyHints];
    }

    set(newState);
  },

  reset: () => {
    set({
      statusText: 'Ready',
      keyHints: defaultKeyHints,
      mode: 'replace'
    });
  }
}));