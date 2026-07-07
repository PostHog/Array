import { create } from "zustand";

// The error behind an error-level toast, captured so the details dialog can
// show the full payload the toast had no room for.
export interface ErrorDetail {
  title: string;
  error: unknown;
  occurredAt: number;
}

// Pretty-printed JSON of an arbitrary error payload that never throws:
// Error instances become plain objects (keeping message, stack, and any
// enumerable extras like `code`), circular references are elided, and
// non-JSON values fall back to String().
export function serializeError(error: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(
      error,
      (_key, value: unknown) => {
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
            ...Object.fromEntries(Object.entries(value)),
          };
        }
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[circular]";
          seen.add(value);
        }
        if (typeof value === "bigint" || typeof value === "function") {
          return String(value);
        }
        return value;
      },
      2,
    );
    return json ?? String(error);
  } catch {
    return String(error);
  }
}

const SUMMARY_LIMIT = 140;

// One-line summary of an error payload, sized for a toast description. The
// full payload stays behind the toast's "Details" action.
export function summarizeError(error: unknown): string {
  let message: string;
  if (typeof error === "string") {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    message = (error as { message: string }).message;
  } else {
    message = serializeError(error);
  }
  const flat = message.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "Unknown error";
  return flat.length <= SUMMARY_LIMIT
    ? flat
    : `${flat.slice(0, SUMMARY_LIMIT)}…`;
}

interface ErrorDetailsState {
  detail: ErrorDetail | null;
  show: (detail: ErrorDetail) => void;
  close: () => void;
}

// View state for the global error details dialog (rendered once in App).
export const useErrorDetailsStore = create<ErrorDetailsState>((set) => ({
  detail: null,
  show: (detail) => set({ detail }),
  close: () => set({ detail: null }),
}));
