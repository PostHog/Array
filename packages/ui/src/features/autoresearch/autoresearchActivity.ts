import { parsePlanReport } from "@posthog/core/autoresearch/prompts";
import type { AcpMessage } from "@posthog/shared";

export type AutoresearchActivityKind =
  | "research"
  | "implementation"
  | "measurement"
  | "reasoning";

export interface AutoresearchActivityItem {
  id: string;
  kind: AutoresearchActivityKind;
  label: string;
  at: number;
  active: boolean;
}

export interface AutoresearchActivitySnapshot {
  currentPlan: ReturnType<typeof parsePlanReport>;
  items: AutoresearchActivityItem[];
  timeByKind: Record<AutoresearchActivityKind, number>;
}

export function analyzeAutoresearchActivity(
  events: AcpMessage[],
  startedAt: number,
  endedAt: number | null,
  now: number,
): AutoresearchActivitySnapshot {
  const relevant = events.filter(
    (event) =>
      event.ts >= startedAt && (endedAt === null || event.ts <= endedAt),
  );
  const items: AutoresearchActivityItem[] = [];
  const agentText: string[] = [];

  for (const event of relevant) {
    const message = event.message;
    if (!("method" in message) || message.method !== "session/update") continue;
    const params = message.params as
      | {
          update?: {
            sessionUpdate?: string;
            title?: string;
            kind?: string | null;
            status?: string | null;
            content?: { type?: string; text?: string };
          };
        }
      | undefined;
    const update = params?.update;
    if (!update) continue;

    if (
      update.sessionUpdate === "agent_message_chunk" &&
      update.content?.type === "text" &&
      update.content.text
    ) {
      agentText.push(update.content.text);
      continue;
    }

    if (update.sessionUpdate !== "tool_call") continue;
    const kind = activityKindForTool(update.kind);
    items.push({
      id: `${event.ts}:${update.title ?? "tool"}`,
      kind,
      label: update.title || activityLabel(kind),
      at: event.ts,
      active: update.status === "in_progress" || update.status === "pending",
    });
  }

  const currentPlan = parsePlanReport(agentText.join(""));
  const end = endedAt ?? now;
  const boundaries = items.map((item) => ({ at: item.at, kind: item.kind }));
  const timeByKind: Record<AutoresearchActivityKind, number> = {
    research: 0,
    implementation: 0,
    measurement: 0,
    reasoning: 0,
  };
  let cursor = startedAt;
  let kind: AutoresearchActivityKind = "reasoning";
  for (const boundary of boundaries) {
    timeByKind[kind] += Math.max(0, boundary.at - cursor);
    cursor = boundary.at;
    kind = boundary.kind;
  }
  timeByKind[kind] += Math.max(0, end - cursor);

  return {
    currentPlan,
    items: items.slice(-8).reverse(),
    timeByKind,
  };
}

function activityKindForTool(kind?: string | null): AutoresearchActivityKind {
  if (kind === "edit" || kind === "delete" || kind === "move") {
    return "implementation";
  }
  if (kind === "execute") return "measurement";
  if (kind === "read" || kind === "search" || kind === "fetch") {
    return "research";
  }
  return "reasoning";
}

function activityLabel(kind: AutoresearchActivityKind): string {
  if (kind === "implementation") return "Editing code";
  if (kind === "measurement") return "Running a command";
  if (kind === "research") return "Inspecting the codebase";
  return "Working";
}
