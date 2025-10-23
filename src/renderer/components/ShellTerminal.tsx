import { Box } from "@radix-ui/themes";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useLayoutStore } from "../stores/layoutStore";

interface ShellTerminalProps {
  cwd?: string;
}

export function ShellTerminal({ cwd }: ShellTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const cliMode = useLayoutStore((state) => state.cliMode);
  const setCliMode = useLayoutStore((state) => state.setCliMode);

  // Cmd+K to clear terminal
  useHotkeys("meta+k, ctrl+k", (event) => {
    event.preventDefault();
    terminal.current?.clear();
  });

  // Auto-focus terminal when switching to shell mode
  useEffect(() => {
    if (cliMode === "shell" && terminal.current) {
      // Use requestAnimationFrame to ensure the component is visible before focusing
      requestAnimationFrame(() => {
        terminal.current?.focus();
      });
    }
  }, [cliMode]);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Generate unique session ID for this effect run
    const sessionId = `shell-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    sessionIdRef.current = sessionId;

    // Initialize terminal with same styling as task mode
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12, // Matches var(--font-size-1)
      fontFamily: "monospace",
      theme: {
        background: "transparent",
        foreground: "#ffffff", // White text
        cursor: "#BD6C3A", // Orange cursor matching task mode
        cursorAccent: "#ffffff", // White text under cursor
        selectionBackground: "#532601", // Dark orange selection
        selectionForeground: "#ffffff",
      },
      cursorStyle: "block",
      cursorWidth: 8,
      allowProposedApi: true,
    });

    // Handle Shift+Tab directly to switch modes (xterm would otherwise consume it)
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // Check for Shift+Tab (and only Shift+Tab, no other modifiers)
      // Only respond to actual keydown, not repeat or release events
      if (
        event.type === "keydown" &&
        !event.repeat &&
        event.key === "Tab" &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        // Manually trigger mode switch since event won't bubble to global handler
        event.preventDefault();
        setCliMode(cliMode === "task" ? "shell" : "task");
        return false; // Don't let xterm handle this
      }
      // Let xterm handle everything else normally
      return true;
    });

    // Load addons
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    // Open terminal
    term.open(terminalRef.current);

    // Fit terminal to container
    fit.fit();

    // Store refs
    terminal.current = term;
    fitAddon.current = fit;

    // Create PTY session
    window.electronAPI?.shellCreate(sessionId, cwd).catch((error: Error) => {
      console.error("Failed to create shell session:", error);
      term.writeln(
        `\r\n\x1b[31mFailed to create shell: ${error.message}\x1b[0m\r\n`,
      );
    });

    // Listen for data from PTY
    const unsubscribeData = window.electronAPI?.onShellData(
      sessionId,
      (data: string) => {
        term.write(data);
      },
    );

    // Listen for shell exit
    const unsubscribeExit = window.electronAPI?.onShellExit(sessionId, () => {
      term.writeln("\r\n\x1b[33mShell process exited\x1b[0m\r\n");
    });

    // Send user input to PTY
    const disposable = term.onData((data: string) => {
      window.electronAPI?.shellWrite(sessionId, data).catch((error: Error) => {
        console.error("Failed to write to shell:", error);
      });
    });

    // Handle resize
    const handleResize = () => {
      if (fit && term) {
        fit.fit();
        window.electronAPI
          ?.shellResize(sessionId, term.cols, term.rows)
          .catch((error: Error) => {
            console.error("Failed to resize shell:", error);
          });
      }
    };

    // Initial resize
    handleResize();

    // Listen for window resize
    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      disposable.dispose();
      unsubscribeData?.();
      unsubscribeExit?.();
      window.electronAPI?.shellDestroy(sessionId).catch((error: Error) => {
        console.error("Failed to destroy shell session:", error);
      });
      term.dispose();
    };
  }, [cwd, cliMode, setCliMode]);

  return (
    <Box
      style={{
        height: "100%",
        padding: "var(--space-3)",
        position: "relative",
      }}
    >
      <div
        ref={terminalRef}
        style={{
          height: "100%",
          width: "100%",
        }}
      />
      <style>
        {`
          .xterm {
            background-color: transparent !important;
          }
          .xterm .xterm-viewport {
            background-color: transparent !important;
          }
          .xterm .xterm-viewport::-webkit-scrollbar {
            display: none;
          }
          .xterm .xterm-viewport {
            scrollbar-width: none;
          }
        `}
      </style>
    </Box>
  );
}
