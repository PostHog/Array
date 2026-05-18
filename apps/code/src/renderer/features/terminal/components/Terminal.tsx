import { Box } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { useThemeStore } from "@stores/themeStore";
import "@xterm/xterm/css/xterm.css";

import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useEffect, useRef } from "react";
import { terminalManager } from "../services/TerminalManager";

export interface TerminalProps {
  sessionId: string;
  persistenceKey: string;
  cwd?: string;
  initialState?: string;
  taskId?: string;
  command?: string;
  onReady?: () => void;
  onExit?: (exitCode?: number) => void;
}

export function Terminal({
  sessionId,
  persistenceKey,
  cwd,
  initialState,
  taskId,
  command,
  onReady,
  onExit,
}: TerminalProps) {
  const trpcReact = useTRPC();
  const terminalRef = useRef<HTMLDivElement>(null);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);

  // Create instance (idempotent)
  useEffect(() => {
    if (!terminalManager.has(sessionId)) {
      terminalManager.create({
        sessionId,
        persistenceKey,
        cwd,
        initialState,
        taskId,
        command,
      });
    }
  }, [sessionId, persistenceKey, cwd, initialState, taskId, command]);

  // Attach/detach from DOM
  useEffect(() => {
    if (!terminalRef.current) return;

    terminalManager.attach(sessionId, terminalRef.current);
    terminalManager.focus(sessionId);

    return () => {
      terminalManager.detach(sessionId);
    };
  }, [sessionId]);

  // Theme sync
  useEffect(() => {
    terminalManager.setTheme(isDarkMode);
  }, [isDarkMode]);

  // Subscribe to shell data events
  useSubscription(
    trpcReact.shell.onData.subscriptionOptions(
      { sessionId },
      {
        enabled: !!sessionId,
        onData: (event) => {
          terminalManager.writeData(event.sessionId, event.data);
        },
      },
    ),
  );

  // Subscribe to shell exit events
  useSubscription(
    trpcReact.shell.onExit.subscriptionOptions(
      { sessionId },
      {
        enabled: !!sessionId,
        onData: (event) => {
          terminalManager.handleExit(event.sessionId, event.exitCode);
        },
      },
    ),
  );

  // Event callbacks
  useEffect(() => {
    const offReady = terminalManager.on("ready", ({ sessionId: id }) => {
      if (id === sessionId) {
        onReady?.();
      }
    });

    const offExit = terminalManager.on(
      "exit",
      ({ sessionId: id, exitCode }) => {
        if (id === sessionId) {
          onExit?.(exitCode);
        }
      },
    );

    return () => {
      offReady();
      offExit();
    };
  }, [sessionId, onReady, onExit]);

  // mousedown so the xterm textarea is focused before the browser's native focus shift, not after.
  const handleMouseDown = useCallback(() => {
    terminalManager.focus(sessionId);
  }, [sessionId]);

  return (
    <Box onMouseDown={handleMouseDown} className="relative h-full p-3">
      <div ref={terminalRef} className="h-full w-full" />
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
