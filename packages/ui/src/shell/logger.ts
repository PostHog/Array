import { resolveService } from "@posthog/di/container";

export interface ScopedLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export interface HostLogger extends ScopedLogger {
  scope(name: string): ScopedLogger;
}

export const HOST_LOGGER = Symbol.for("posthog.ui.HostLogger");

function impl(): HostLogger | null {
  try {
    return resolveService<HostLogger>(HOST_LOGGER);
  } catch {
    return null;
  }
}

function deferredScope(name: string): ScopedLogger {
  return {
    info: (...args) =>
      impl()
        ?.scope(name)
        .info(...args),
    warn: (...args) =>
      impl()
        ?.scope(name)
        .warn(...args),
    error: (...args) =>
      impl()
        ?.scope(name)
        .error(...args),
    debug: (...args) =>
      impl()
        ?.scope(name)
        .debug(...args),
  };
}

export const logger: HostLogger = {
  scope: (name) => deferredScope(name),
  info: (...args) => impl()?.info(...args),
  warn: (...args) => impl()?.warn(...args),
  error: (...args) => impl()?.error(...args),
  debug: (...args) => impl()?.debug(...args),
};
