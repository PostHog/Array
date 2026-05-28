import { trpcClient } from "@renderer/trpc";
import { logger } from "@utils/logger";
import { isMac } from "@utils/platform";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import { DEFAULT_TERMINAL_FONT_FAMILY } from "../utils/resolveTerminalFontFamily";

const log = logger.scope("terminal-manager");

let parkingContainer: HTMLElement | null = null;

function getParkingContainer(): HTMLElement {
  if (!parkingContainer) {
    parkingContainer = document.createElement("div");
    parkingContainer.id = "terminal-parking";
    parkingContainer.style.position = "absolute";
    parkingContainer.style.visibility = "hidden";
    parkingContainer.style.pointerEvents = "none";
    parkingContainer.style.width = "0";
    parkingContainer.style.height = "0";
    parkingContainer.style.overflow = "hidden";
    document.body.appendChild(parkingContainer);
  }
  return parkingContainer;
}

export interface TerminalInstance {
  term: XTerm;
  fitAddon: FitAddon;
  serializeAddon: SerializeAddon;
  attachedElement: HTMLElement | null;
  terminalElement: HTMLElement | null;
  isReady: boolean;
  hasOpened: boolean;
  cleanups: Array<() => void>;
  resizeObserver: ResizeObserver | null;
  saveTimeout: number | null;
  persistenceKey: string;
  cwd?: string;
  taskId?: string;
}

export interface CreateOptions {
  sessionId: string;
  persistenceKey: string;
  cwd?: string;
  initialState?: string;
  taskId?: string;
  command?: string;
}

type ReadyPayload = { sessionId: string; persistenceKey: string };
type ExitPayload = {
  sessionId: string;
  persistenceKey: string;
  exitCode?: number;
};
type StateChangePayload = {
  sessionId: string;
  persistenceKey: string;
  serializedState: string;
};

type EventPayloadMap = {
  ready: ReadyPayload;
  exit: ExitPayload;
  stateChange: StateChangePayload;
};

type EventType = keyof EventPayloadMap;
type Listener<T extends EventType> = (payload: EventPayloadMap[T]) => void;

function getTerminalTheme(isDarkMode: boolean) {
  return isDarkMode
    ? {
        background: "#131316",
        foreground: "#e6e6e6",
        cursor: "#f8be2a",
        cursorAccent: "#131316",
        selectionBackground: "rgba(248, 190, 42, 0.25)",
        selectionInactiveBackground: "rgba(248, 190, 42, 0.12)",
        selectionForeground: "#e6e6e6",
      }
    : {
        background: "#f2f3ee",
        foreground: "#3a4036",
        cursor: "#f54d00",
        cursorAccent: "#f2f3ee",
        selectionBackground: "#fbd0b8",
        selectionInactiveBackground: "#f3e2d6",
        selectionForeground: "#3a4036",
      };
}

function loadAddons(term: XTerm) {
  const fit = new FitAddon();
  const serialize = new SerializeAddon();

  const activateLink = (_event: MouseEvent, uri: string) => {
    trpcClient.os.openExternal.mutate({ url: uri }).catch((error: Error) => {
      log.error("Failed to open link:", uri, error);
    });
  };

  const webLinks = new WebLinksAddon(activateLink);

  term.loadAddon(fit);
  term.loadAddon(serialize);
  term.loadAddon(webLinks);

  return { fit, serialize };
}

function attachKeyHandlers(term: XTerm) {
  term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

    if (event.key === "k" && cmdOrCtrl && event.type === "keydown") {
      event.preventDefault();
      term.clear();
      return false;
    }

    if (event.key === "w" && cmdOrCtrl) {
      return false;
    }

    if (event.key === "r" && cmdOrCtrl && !event.shiftKey) {
      return false;
    }

    if (cmdOrCtrl && event.key >= "1" && event.key <= "9") {
      return false;
    }

    return true;
  });
}

class TerminalManagerImpl {
  private instances = new Map<string, TerminalInstance>();
  private listeners = new Map<EventType, Set<Listener<EventType>>>();
  private isDarkMode = true;
  private fontFamily: string = DEFAULT_TERMINAL_FONT_FAMILY;

  has(sessionId: string): boolean {
    return this.instances.has(sessionId);
  }

  get(sessionId: string): TerminalInstance | undefined {
    return this.instances.get(sessionId);
  }

  create(options: CreateOptions): TerminalInstance {
    const { sessionId, persistenceKey, cwd, initialState, taskId, command } =
      options;

    const existing = this.instances.get(sessionId);
    if (existing) {
      return existing;
    }

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: this.fontFamily,
      theme: getTerminalTheme(this.isDarkMode),
      cursorStyle: "block",
      cursorWidth: 8,
      allowProposedApi: true,
    });

    const { fit, serialize } = loadAddons(term);
    attachKeyHandlers(term);

    const instance: TerminalInstance = {
      term,
      fitAddon: fit,
      serializeAddon: serialize,
      attachedElement: null,
      terminalElement: null,
      isReady: false,
      hasOpened: false,
      cleanups: [],
      resizeObserver: null,
      saveTimeout: null,
      persistenceKey,
      cwd,
      taskId,
    };

    if (initialState) {
      term.write(initialState);
    }

    // Setup user input handler
    const disposable = term.onData((data: string) => {
      trpcClient.shell.write
        .mutate({ sessionId, data })
        .catch((error: Error) => {
          log.error("Failed to write to shell:", error);
        });
      this.scheduleSave(sessionId, instance);
    });
    instance.cleanups.push(() => disposable.dispose());

    // Initialize shell session
    this.initializeSession(sessionId, instance, cwd, taskId, command);

    this.instances.set(sessionId, instance);
    return instance;
  }

  private async initializeSession(
    sessionId: string,
    instance: TerminalInstance,
    cwd?: string,
    taskId?: string,
    command?: string,
  ): Promise<void> {
    try {
      const sessionExists = await trpcClient.shell.check.query({ sessionId });
      if (!sessionExists) {
        if (instance.attachedElement) {
          instance.fitAddon.fit();
        }

        if (command && cwd) {
          await trpcClient.shell.createCommand.mutate({
            sessionId,
            command,
            cwd,
            taskId,
          });
        } else {
          await trpcClient.shell.create.mutate({ sessionId, cwd, taskId });
        }
      }

      instance.isReady = true;

      if (instance.attachedElement) {
        instance.fitAddon.fit();
        trpcClient.shell.resize
          .mutate({
            sessionId,
            cols: instance.term.cols,
            rows: instance.term.rows,
          })
          .catch((error: Error) => {
            log.error("Failed to sync initial terminal size:", error);
          });
      }

      this.emit("ready", {
        sessionId,
        persistenceKey: instance.persistenceKey,
      });
    } catch (error) {
      log.error("Failed to initialize session:", sessionId, error);
      instance.term.writeln(
        `\r\n\x1b[31mFailed to create shell: ${(error as Error).message}\x1b[0m\r\n`,
      );
    }
  }

  writeData(sessionId: string, data: string): void {
    const instance = this.instances.get(sessionId);
    if (instance) {
      instance.term.write(data);
      this.scheduleSave(sessionId, instance);
    }
  }

  handleExit(sessionId: string, exitCode?: number): void {
    const instance = this.instances.get(sessionId);
    if (instance) {
      // Without this, ResizeObserver keeps firing shell.resize against the dead
      // session on every layout shift, producing a TRPC error per call and
      // wedging the renderer.
      instance.isReady = false;
      this.disconnectResizeObserver(instance);
      this.emit("exit", {
        sessionId,
        persistenceKey: instance.persistenceKey,
        exitCode,
      });
    }
  }

  private disconnectResizeObserver(instance: TerminalInstance): void {
    if (instance.resizeObserver) {
      instance.resizeObserver.disconnect();
      instance.resizeObserver = null;
    }
  }

  private scheduleSave(sessionId: string, instance: TerminalInstance): void {
    if (instance.saveTimeout) {
      clearTimeout(instance.saveTimeout);
    }

    instance.saveTimeout = window.setTimeout(() => {
      const serialized = instance.serializeAddon.serialize();
      this.emit("stateChange", {
        sessionId,
        persistenceKey: instance.persistenceKey,
        serializedState: serialized,
      });
    }, 500);
  }

  attach(sessionId: string, element: HTMLElement): void {
    const instance = this.instances.get(sessionId);
    if (!instance) {
      log.error("Cannot attach: instance not found:", sessionId);
      return;
    }

    if (instance.attachedElement === element) {
      return;
    }

    this.disconnectResizeObserver(instance);

    instance.attachedElement = element;

    if (!instance.hasOpened) {
      instance.term.open(element);
      instance.hasOpened = true;
      instance.terminalElement = element.querySelector(".xterm") as HTMLElement;
    } else if (instance.terminalElement) {
      element.appendChild(instance.terminalElement);
      instance.term.refresh(0, instance.term.rows - 1);
    }

    const handleResize = () => {
      if (instance.fitAddon) {
        instance.fitAddon.fit();

        if (instance.isReady) {
          trpcClient.shell.resize
            .mutate({
              sessionId,
              cols: instance.term.cols,
              rows: instance.term.rows,
            })
            .catch((error: Error) => {
              log.error("Failed to resize shell:", error);
            });
        }
      }
    };

    instance.resizeObserver = new ResizeObserver(handleResize);
    instance.resizeObserver.observe(element);

    setTimeout(() => {
      instance.fitAddon.fit();
    }, 0);
  }

  detach(sessionId: string): void {
    const instance = this.instances.get(sessionId);
    if (!instance || !instance.attachedElement) {
      return;
    }

    this.disconnectResizeObserver(instance);

    const serialized = instance.serializeAddon.serialize();
    this.emit("stateChange", {
      sessionId,
      persistenceKey: instance.persistenceKey,
      serializedState: serialized,
    });

    if (instance.terminalElement) {
      getParkingContainer().appendChild(instance.terminalElement);
    }

    instance.attachedElement = null;
  }

  destroy(sessionId: string): void {
    const instance = this.instances.get(sessionId);
    if (!instance) {
      return;
    }

    if (instance.attachedElement) {
      this.detach(sessionId);
    }

    if (instance.saveTimeout) {
      clearTimeout(instance.saveTimeout);
    }

    for (const cleanup of instance.cleanups) {
      cleanup();
    }

    instance.term.dispose();

    this.instances.delete(sessionId);
  }

  focus(sessionId: string): void {
    const instance = this.instances.get(sessionId);
    if (instance) {
      instance.term.focus();
    }
  }

  clear(sessionId: string): void {
    const instance = this.instances.get(sessionId);
    if (instance) {
      instance.term.clear();
    }
  }

  serialize(sessionId: string): string | null {
    const instance = this.instances.get(sessionId);
    if (!instance) {
      return null;
    }
    return instance.serializeAddon.serialize();
  }

  setTheme(isDarkMode: boolean): void {
    if (this.isDarkMode === isDarkMode) {
      return;
    }

    this.isDarkMode = isDarkMode;
    const theme = getTerminalTheme(isDarkMode);

    for (const instance of this.instances.values()) {
      instance.term.options.theme = theme;
    }
  }

  setFontFamily(fontFamily: string): void {
    if (this.fontFamily === fontFamily) {
      return;
    }

    this.fontFamily = fontFamily;

    for (const instance of this.instances.values()) {
      instance.term.options.fontFamily = fontFamily;
      // Parked terminals live in a 0x0 container, so fit would compute garbage.
      // attach() refits on reattachment, so skipping here is safe.
      if (!instance.attachedElement) continue;
      try {
        instance.fitAddon.fit();
      } catch (error) {
        log.error("Failed to refit after font change:", error);
      }
    }
  }

  on<T extends EventType>(event: T, listener: Listener<T>): () => void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }

    listeners.add(listener as Listener<EventType>);

    return () => {
      listeners.delete(listener as Listener<EventType>);
    };
  }

  private emit<T extends EventType>(
    event: T,
    payload: EventPayloadMap[T],
  ): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(payload);
        } catch (error) {
          log.error("Event listener error:", event, error);
        }
      }
    }
  }

  destroyByPrefix(prefix: string): void {
    for (const sessionId of this.instances.keys()) {
      if (sessionId.startsWith(prefix)) {
        this.destroy(sessionId);
      }
    }
  }

  getSessionsByPrefix(prefix: string): string[] {
    const result: string[] = [];
    for (const sessionId of this.instances.keys()) {
      if (sessionId.startsWith(prefix)) {
        result.push(sessionId);
      }
    }
    return result;
  }
}

export const terminalManager = new TerminalManagerImpl();
