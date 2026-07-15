import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { inject, injectable } from "inversify";
import {
  buildNotebookNodeChangeSystemPrompt,
  buildNotebookNodeChangeUserPrompt,
  buildNotebookNodeSummarySystemPrompt,
  buildNotebookNodeSummaryUserPrompt,
  getNotebookNodeKnowledge,
} from "./notebookNodeAIKnowledge";
import {
  NOTEBOOK_NODE_AI_MODEL,
  type NotebookNodeAIModel,
} from "./notebookNodeAIModel";
import type {
  NotebookNodeJsonObject,
  NotebookNodeJsonValue,
} from "./notebookNodeSummary";
import { notebookNodeAIChangeResponseSchema } from "./schemas";

export interface NotebookNodeAIInput {
  tagName: string;
  props: NotebookNodeJsonObject;
}

export interface NotebookNodeAIChange {
  /** Complete replacement props (shell-managed props reattached). */
  props: NotebookNodeJsonObject;
  summary: string;
}

// Props the component shell manages (panel visibility toggles). They are
// noise to the model: stripped from prompts and cache keys, preserved
// verbatim across AI edits.
const SHELL_MANAGED_PROPS = new Set(["hideFilters", "hideResults"]);

/** Longest live-entity JSON we are willing to spend prompt tokens on. */
const MAX_ENTITY_CONTEXT_CHARS = 1200;

/**
 * AI summarizer + change-request engine behind the notebook node edit panel.
 * Owns prompt construction, the model call, response parsing/validation with
 * one retry, and an in-memory summary cache keyed by (tagName + props) so
 * reopening a node is instant. Host-neutral: the authenticated api client is
 * passed per call (the renderer container has no AuthService binding), the
 * model transport is injected.
 */
@injectable()
export class NotebookNodeAIService {
  private readonly summaryCache = new Map<string, string>();
  /** Coalesces concurrent summarize calls for the same node state. */
  private readonly pendingSummaries = new Map<string, Promise<string>>();

  constructor(
    @inject(NOTEBOOK_NODE_AI_MODEL)
    private readonly model: NotebookNodeAIModel,
  ) {}

  /** Synchronous cache probe so the UI can render a known summary instantly. */
  getCachedSummary(input: NotebookNodeAIInput): string | null {
    return this.summaryCache.get(summaryCacheKey(input)) ?? null;
  }

  /** Pre-seed the cache (e.g. with the summary returned by a change request). */
  primeSummary(input: NotebookNodeAIInput, summary: string): void {
    this.summaryCache.set(summaryCacheKey(input), summary);
  }

  async summarizeNode(
    client: PostHogAPIClient,
    input: NotebookNodeAIInput,
    options?: {
      signal?: AbortSignal;
      /** Full accumulated summary text on every streamed delta. */
      onPartial?: (text: string) => void;
    },
  ): Promise<string> {
    const key = summaryCacheKey(input);
    const cached = this.summaryCache.get(key);
    if (cached) return cached;
    const pending = this.pendingSummaries.get(key);
    if (pending) return pending;

    const run = (async () => {
      const liveEntityJson = await this.fetchEntityContext(client, input);
      const raw = await this.model.complete(client, {
        system: buildNotebookNodeSummarySystemPrompt(),
        user: buildNotebookNodeSummaryUserPrompt({
          tagName: input.tagName,
          propsJson: promptPropsJson(input.props),
          knowledge: getNotebookNodeKnowledge(input.tagName),
          liveEntityJson,
        }),
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.onPartial
          ? {
              onText: (text: string) => options.onPartial?.(cleanSummary(text)),
            }
          : {}),
      });
      const summary = cleanSummary(raw);
      if (!summary) throw new Error("AI returned an empty summary");
      this.summaryCache.set(key, summary);
      return summary;
    })();
    this.pendingSummaries.set(key, run);
    try {
      return await run;
    } finally {
      this.pendingSummaries.delete(key);
    }
  }

  /**
   * Apply a natural-language change request to a node. One model call returns
   * both the replacement props and the new summary; invalid replies get one
   * retry with the parse problem quoted back.
   */
  async requestNodeChange(
    client: PostHogAPIClient,
    input: NotebookNodeAIInput,
    request: string,
    options?: { signal?: AbortSignal },
  ): Promise<NotebookNodeAIChange> {
    const liveEntityJson = await this.fetchEntityContext(client, input);
    const basePrompt = {
      tagName: input.tagName,
      propsJson: promptPropsJson(input.props),
      knowledge: getNotebookNodeKnowledge(input.tagName),
      request,
      currentSummary: this.getCachedSummary(input),
      liveEntityJson,
    };

    let retryContext: { previousResponse: string; problem: string } | null =
      null;
    let lastProblem = "unknown";
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.model.complete(client, {
        system: buildNotebookNodeChangeSystemPrompt(),
        user: buildNotebookNodeChangeUserPrompt({
          ...basePrompt,
          retryContext,
        }),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      const outcome = parseNodeChangeResponse(input.tagName, raw);
      if (outcome.ok) {
        const props = reattachShellProps(input.props, outcome.props);
        const summary = cleanSummary(outcome.summary);
        this.primeSummary({ tagName: input.tagName, props }, summary);
        return { props, summary };
      }
      lastProblem = outcome.problem;
      retryContext = {
        previousResponse: raw.slice(0, 2000),
        problem: outcome.problem,
      };
    }
    throw new Error(`AI response could not be applied: ${lastProblem}`);
  }

  /**
   * Best-effort live-object fetch for entity nodes so summaries can name the
   * flag/experiment/survey instead of parroting an id. Failures (bad id, no
   * access, offline) degrade to props-only prompts.
   */
  private async fetchEntityContext(
    client: PostHogAPIClient,
    input: NotebookNodeAIInput,
  ): Promise<string | null> {
    try {
      const picked = await pickEntityContext(client, input);
      if (!picked) return null;
      const json = JSON.stringify(picked);
      return json.length > MAX_ENTITY_CONTEXT_CHARS
        ? `${json.slice(0, MAX_ENTITY_CONTEXT_CHARS)}…`
        : json;
    } catch {
      return null;
    }
  }
}

async function pickEntityContext(
  client: PostHogAPIClient,
  input: NotebookNodeAIInput,
): Promise<Record<string, unknown> | null> {
  const props = input.props;
  const id = props.id;
  switch (input.tagName) {
    case "FeatureFlag": {
      if (typeof id !== "string" && typeof id !== "number") return null;
      const flag = await client.getFeatureFlag(String(id));
      return { key: flag.key, name: flag.name, active: flag.active };
    }
    case "Experiment": {
      if (typeof id !== "number") return null;
      const experiment = await client.getExperiment(id);
      return {
        name: experiment.name,
        description: experiment.description ?? undefined,
        start_date: experiment.start_date ?? undefined,
        end_date: experiment.end_date ?? undefined,
        feature_flag_key: experiment.feature_flag_key ?? undefined,
      };
    }
    case "Survey": {
      if (typeof id !== "string") return null;
      const survey = await client.getSurvey(id);
      return {
        name: survey.name,
        type: survey.type ?? undefined,
        start_date: survey.start_date ?? undefined,
        end_date: survey.end_date ?? undefined,
        questions: (survey.questions ?? [])
          .slice(0, 5)
          .map((question) =>
            question && typeof question === "object" && "question" in question
              ? (question as { question?: unknown }).question
              : undefined,
          ),
      };
    }
    case "EarlyAccessFeature": {
      if (typeof id !== "string") return null;
      const feature = await client.getEarlyAccessFeature(id);
      return {
        name: feature.name,
        stage: feature.stage ?? undefined,
        description: feature.description?.slice(0, 200),
      };
    }
    case "Cohort": {
      if (typeof id !== "number") return null;
      const cohort = await client.getCohort(id);
      return {
        name: cohort.name,
        count: cohort.count ?? undefined,
        is_static: cohort.is_static,
      };
    }
    case "Person": {
      const distinctId = props.distinctId;
      if (typeof distinctId !== "string") return null;
      const person = await client.getPerson({ distinctId });
      return {
        name: person.name ?? undefined,
        email: person.properties?.email ?? person.properties?.$email,
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests and for the UI's apply step)
// ---------------------------------------------------------------------------

/**
 * Turn a full replacement props object into the partial-update shape the
 * notebook shell's `updateProps` expects: keys missing from `next` are set to
 * `undefined` so they get removed, shell-managed props are never deleted.
 */
export function buildNotebookNodePropsUpdate(
  current: NotebookNodeJsonObject,
  next: NotebookNodeJsonObject,
): Record<string, NotebookNodeJsonValue | undefined> {
  const update: Record<string, NotebookNodeJsonValue | undefined> = {
    ...next,
  };
  for (const key of Object.keys(current)) {
    if (!(key in next) && !SHELL_MANAGED_PROPS.has(key)) {
      update[key] = undefined;
    }
  }
  for (const key of SHELL_MANAGED_PROPS) {
    delete update[key];
  }
  return update;
}

function reattachShellProps(
  current: NotebookNodeJsonObject,
  next: NotebookNodeJsonObject,
): NotebookNodeJsonObject {
  const merged: NotebookNodeJsonObject = { ...next };
  for (const key of SHELL_MANAGED_PROPS) {
    delete merged[key];
    if (key in current) {
      merged[key] = current[key] as NotebookNodeJsonValue;
    }
  }
  return merged;
}

function stripShellProps(
  props: NotebookNodeJsonObject,
): NotebookNodeJsonObject {
  const stripped: NotebookNodeJsonObject = {};
  for (const [key, value] of Object.entries(props)) {
    if (!SHELL_MANAGED_PROPS.has(key)) stripped[key] = value;
  }
  return stripped;
}

function promptPropsJson(props: NotebookNodeJsonObject): string {
  return JSON.stringify(stripShellProps(props), null, 1);
}

/** FNV-1a over a stable (key-sorted) serialization — cache key material. */
export function notebookNodeAICacheKey(input: NotebookNodeAIInput): string {
  return summaryCacheKey(input);
}

function summaryCacheKey(input: NotebookNodeAIInput): string {
  const canonical = stableStringify(stripShellProps(input.props));
  let hash = 0x811c9dc5;
  const text = `${input.tagName} ${canonical}`;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${input.tagName}:${(hash >>> 0).toString(16)}`;
}

function stableStringify(value: NotebookNodeJsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Strip fences/quotes/whitespace the model may wrap a plain-text reply in. */
function cleanSummary(text: string): string {
  let cleaned = text.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n?```$/.exec(cleaned);
  if (fence?.[1] !== undefined) cleaned = fence[1].trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length > 1) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned.replace(/\s+/g, " ");
}

type ParseOutcome =
  | { ok: true; props: NotebookNodeJsonObject; summary: string }
  | { ok: false; problem: string };

export function parseNodeChangeResponse(
  tagName: string,
  raw: string,
): ParseOutcome {
  const jsonText = extractFirstJsonObject(raw);
  if (!jsonText) {
    return { ok: false, problem: "no JSON object found in the reply" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return {
      ok: false,
      problem: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const validated = notebookNodeAIChangeResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      problem: `reply must be {"props": object, "summary": string} — ${validated.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    };
  }
  const props = validated.data.props as NotebookNodeJsonObject;
  const shapeProblem = validateChangedProps(tagName, props);
  if (shapeProblem) {
    return { ok: false, problem: shapeProblem };
  }
  return { ok: true, props, summary: validated.data.summary };
}

/** Per-tag structural sanity beyond "is a JSON object". */
function validateChangedProps(
  tagName: string,
  props: NotebookNodeJsonObject,
): string | null {
  if (tagName === "Query") {
    const query = props.query;
    if (!query || typeof query !== "object" || Array.isArray(query)) {
      return 'props.query must be an object with a "kind" field';
    }
    if (typeof (query as NotebookNodeJsonObject).kind !== "string") {
      return 'props.query.kind must be a string (e.g. "InsightVizNode")';
    }
  }
  return null;
}

/**
 * Extract the first balanced top-level JSON object from free-form model
 * output (handles fences and prose around the object, and braces inside
 * strings).
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}
