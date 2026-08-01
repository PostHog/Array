import { toast as quillToast } from "@posthog/quill";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";

// Thin wrapper over quill's toast so the whole app shares one import and a
// stable `(title, options)` signature. Quill (base-ui under the hood) owns
// rendering, stacking, auto-dismiss, hover-to-pause, and the close button —
// which is why this exists instead of a hand-rolled custom toast.

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  description?: string;
  // A caller-chosen stable id: upserts (creates or replaces) the toast with
  // that id so it never stacks. quill itself can't
  // pick an id at create time, so the wrapper maps it (see idRegistry).
  id?: string;
  action?: ToastAction;
  // Auto-dismiss delay in ms. Maps to quill's `timeout`. Omit for the provider
  // default; loading toasts never auto-dismiss regardless.
  duration?: number;
}

// The second argument may be a bare description string (shorthand) or the full
// options object.
type Detail = string | ToastOptions;

type Level = "success" | "error" | "info" | "warning" | "loading";

// Maps a caller-chosen stable id → quill's generated id, so `{ id }` behaves as
// an upsert: the first call creates a quill toast and records the mapping; a
// repeat call (or a different level) updates that same toast instead of
// stacking; `dismiss(id)` resolves through here. Entries self-clean on close.
const idRegistry = new Map<string, string>();

// Mirrors quill's <ToastProvider> default; used to time the blur fallback for
// toasts that don't set their own duration. Keep in sync with the provider in
// App.tsx, which mounts <ToastProvider> without a timeout override.
const PROVIDER_DEFAULT_TIMEOUT_MS = 5000;

function normalize(detail?: Detail): ToastOptions {
  return typeof detail === "string" ? { description: detail } : (detail ?? {});
}

// base-ui pauses a toast's auto-dismiss timer whenever the app window isn't
// OS-focused — not only while it's hovered. On the Electron app the window is
// often not frontmost, so a toast can hang on screen until it's closed by hand.
// Back base-ui's timer with one that still clears the toast once its time is up
// while the window is unfocused; when the window is focused we leave base-ui's
// own timer (and its hover-to-pause) in charge. Returns a cleanup to wire into
// the toast's onClose so nothing is left pending once it goes away.
function armBlurDismiss(
  level: Level,
  timeout: number | undefined,
  quillId: string,
): (() => void) | undefined {
  if (level === "loading" || typeof document === "undefined") {
    return undefined;
  }
  const dismissAfter =
    typeof timeout === "number" ? timeout : PROVIDER_DEFAULT_TIMEOUT_MS;
  // timeout 0 is the "never auto-dismiss" contract (e.g. the offline toast).
  if (dismissAfter <= 0) {
    return undefined;
  }
  let onBlur: (() => void) | undefined;
  const timer = setTimeout(() => {
    if (!document.hasFocus()) {
      quillToast.dismiss(quillId);
      return;
    }
    // Focused at the deadline (base-ui is holding it, e.g. hover-paused). Once
    // it's no longer hovered while focused base-ui dismisses it — but if the
    // window loses focus first, base-ui re-pauses and it would hang, so dismiss
    // on the next blur instead of giving up after this single check.
    onBlur = () => quillToast.dismiss(quillId);
    window.addEventListener("blur", onBlur, { once: true });
  }, dismissAfter);
  return () => {
    clearTimeout(timer);
    if (onBlur) {
      window.removeEventListener("blur", onBlur);
      onBlur = undefined;
    }
  };
}

function emit(
  level: Level,
  title: string,
  detail: Detail | undefined,
  defaultTimeout?: number,
): string | undefined {
  const o = normalize(detail);
  // Toasts can be disabled in settings; errors always show since they carry
  // information the user needs regardless of that preference.
  if (level !== "error" && !useSettingsStore.getState().toastNotifications) {
    return o.id;
  }
  // base-ui auto-dismisses any non-loading toast with `timeout > 0`; it has no
  // Infinity special-case (Infinity would fire immediately), so a request to
  // never auto-dismiss maps to `0`.
  const requested = o.duration ?? defaultTimeout;
  const timeout = requested === Number.POSITIVE_INFINITY ? 0 : requested;
  const fields = {
    title,
    description: o.description,
    timeout,
    action: o.action,
  };

  if (o.id !== undefined) {
    const stableId = o.id;
    const existing = idRegistry.get(stableId);
    if (existing !== undefined) {
      quillToast.update(existing, { type: level, ...fields });
      return stableId;
    }
    let cleanupBlurDismiss: (() => void) | undefined;
    const quillId = quillToast[level]({
      ...fields,
      onClose: () => {
        cleanupBlurDismiss?.();
        if (idRegistry.get(stableId) === quillId) idRegistry.delete(stableId);
      },
    });
    idRegistry.set(stableId, quillId);
    cleanupBlurDismiss = armBlurDismiss(level, timeout, quillId);
    return stableId;
  }

  let cleanupBlurDismiss: (() => void) | undefined;
  const quillId = quillToast[level]({
    ...fields,
    onClose: () => cleanupBlurDismiss?.(),
  });
  cleanupBlurDismiss = armBlurDismiss(level, timeout, quillId);
  return quillId;
}

export const toast = {
  success: (title: string, detail?: Detail) => emit("success", title, detail),
  // Errors linger a touch longer than the default, matching prior behavior.
  error: (title: string, detail?: Detail) => emit("error", title, detail, 5000),
  info: (title: string, detail?: Detail) => emit("info", title, detail),
  warning: (title: string, detail?: Detail) => emit("warning", title, detail),
  loading: (title: string, detail?: Detail) => emit("loading", title, detail),
  dismiss: (id?: string) => {
    if (id === undefined) return;
    quillToast.dismiss(idRegistry.get(id) ?? id);
    idRegistry.delete(id);
  },
};
