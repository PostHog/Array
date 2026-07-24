import type { AnySignalReportArtefact } from "@posthog/shared/domain-types";

export type ActivityArtefact = Extract<
  AnySignalReportArtefact,
  { type: "commit" | "task_run" }
>;

export function selectActivityArtefacts(
  artefacts: AnySignalReportArtefact[],
): ActivityArtefact[] {
  return artefacts
    .filter(
      (artefact): artefact is ActivityArtefact =>
        artefact.type === "commit" || artefact.type === "task_run",
    )
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

const SIGNALS_TYPE_LABELS: Record<string, string> = {
  research: "Research",
  implementation: "Implementation",
  repo_selection: "Repo selection",
};

export function humanizeIdentifier(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function taskRunLabel(content: {
  product: string;
  type: string;
}): string {
  return content.product === "signals"
    ? (SIGNALS_TYPE_LABELS[content.type] ?? humanizeIdentifier(content.type))
    : humanizeIdentifier(content.type);
}

export function attributionLabel(artefact: {
  created_by?: { first_name?: string; email: string } | null;
  task_id?: string | null;
}): string | null {
  if (artefact.created_by) {
    return artefact.created_by.first_name?.trim() || artefact.created_by.email;
  }
  return artefact.task_id ? "agent" : null;
}

export type DiffLineKind = "add" | "del" | "hunk" | "context";

export interface DiffLine {
  text: string;
  kind: DiffLineKind;
}

export function parseDiffLines(diff: string): DiffLine[] {
  return diff
    .replace(/\n$/, "")
    .split("\n")
    .map((text) => {
      if (text.startsWith("+") && !text.startsWith("+++")) {
        return { text, kind: "add" as const };
      }
      if (text.startsWith("-") && !text.startsWith("---")) {
        return { text, kind: "del" as const };
      }
      if (text.startsWith("@@")) return { text, kind: "hunk" as const };
      return { text, kind: "context" as const };
    });
}
