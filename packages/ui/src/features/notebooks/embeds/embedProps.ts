import type { NotebookPropValue } from "../markdown-notebook/types";
import type { EmbedBadgeVariant } from "./EmbedCard";

/** Derive a Draft/Running/Complete status from start/end dates (experiments, surveys). */
export function deriveRunStatus(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): { label: "Draft" | "Running" | "Complete"; variant: EmbedBadgeVariant } {
  if (endDate) return { label: "Complete", variant: "info" };
  if (startDate) return { label: "Running", variant: "success" };
  return { label: "Draft", variant: "default" };
}

/** Coerce an id-ish prop (string or number) to a non-empty string. */
export function getIdProp(value: NotebookPropValue | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return null;
}

export function getStringProp(
  value: NotebookPropValue | undefined,
): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getNumberProp(
  value: NotebookPropValue | undefined,
): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format a duration in seconds as `m:ss` (or `h:mm:ss` for long recordings). */
export function formatDuration(
  seconds: number | null | undefined,
): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}
