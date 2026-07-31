import { GitPullRequestIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
  buildInvestigatePrompt,
  type InvestigateContext,
} from "@posthog/core/product-view/investigatePrompt";
import type { ElementDetail } from "@posthog/core/product-view/schemas";
import type { TaskCreationInput } from "@posthog/core/task-detail/taskService";
import { useHostTRPC } from "@posthog/host-router/react";
import { Button, Spinner } from "@posthog/quill";
import { useFolders } from "@posthog/ui/features/folders/useFolders";
import {
  type InboxCloudTaskInputContext,
  useInboxCloudTaskRunner,
} from "@posthog/ui/features/inbox/hooks/useInboxCloudTaskRunner";
import { useUserRepositoryIntegration } from "@posthog/ui/features/integrations/useIntegrations";
import {
  resolveDefaultCloudRepository,
  useSettingsStore,
} from "@posthog/ui/features/settings/settingsStore";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { SelectedElement } from "./useSelectedElement";

/** Stable, grep-able keys identifying this element in source code. */
function needlesFor(element: SelectedElement["element"]): string[] {
  return [element.dataAttr, element.id, element.text].filter(
    (needle): needle is string => !!needle && needle.length >= 3,
  );
}

/**
 * Deterministic PR impact (grep the local checkout → git history + open PRs
 * touching those files) and the Investigate CTA — a cloud task seeded with
 * everything the panel knows, instructed to verify it all with the posthog
 * MCP tools before concluding.
 */
export function InvestigateSection(props: {
  selected: SelectedElement;
  detail: ElementDetail;
  environmentLabel: string;
}) {
  const { selected, detail, environmentLabel } = props;
  const trpc = useHostTRPC();
  const { folders } = useFolders();
  const repoPath = folders[0]?.path ?? null;
  const needles = useMemo(() => needlesFor(selected.element), [selected]);

  const { data: codeContext } = useQuery(
    trpc.productView.getElementCodeContext.queryOptions(
      { repoPath: repoPath ?? "", needles },
      { enabled: !!repoPath && needles.length > 0 },
    ),
  );

  const { repositories } = useUserRepositoryIntegration();
  const lastUsedCloudRepository = useSettingsStore(
    (state) => state.lastUsedCloudRepository,
  );
  const cloudRepository = useMemo(
    () => resolveDefaultCloudRepository(repositories, lastUsedCloudRepository),
    [repositories, lastUsedCloudRepository],
  );

  const prompt = useMemo(() => {
    const context: InvestigateContext = {
      pageUrl: selected.pageUrl,
      environmentLabel,
      dataProjectId: detail.dataProjectId,
      element: selected.element,
      totals: detail.totals,
      errors: detail.errors,
      sessionIds: detail.sessions.map((s) => s.sessionId),
      traceIds: [
        ...new Set(
          detail.recentRequests
            .map((r) => r.traceId)
            .filter((t): t is string => !!t),
        ),
      ].slice(0, 5),
      liveLatency: detail.liveLatency,
      sourceFiles: codeContext?.files ?? [],
      mergedPrs: codeContext?.mergedPrs ?? [],
      openPrs: codeContext?.openPrs ?? [],
    };
    return buildInvestigatePrompt(context);
  }, [selected, detail, codeContext, environmentLabel]);

  const buildInput = useCallback(
    (ctx: InboxCloudTaskInputContext): TaskCreationInput => ({
      content: prompt,
      taskDescription: `Investigate: ${
        selected.element.text ??
        selected.element.dataAttr ??
        `<${selected.element.tag}>`
      } on ${selected.pageUrl}`,
      repository: ctx.cloudRepository,
      githubUserIntegrationId: ctx.githubUserIntegrationId ?? undefined,
      workspaceMode: "cloud",
      executionMode: "auto",
      adapter: ctx.adapter,
      model: ctx.model,
      reasoningLevel: ctx.reasoningLevel,
    }),
    [prompt, selected],
  );

  const { run, isRunning } = useInboxCloudTaskRunner({
    cloudRepository,
    // Investigation is PostHog-MCP-first; a missing repo shouldn't block it.
    allowMissingRepository: true,
    loggerScope: "product-view-investigate",
    copy: {
      loadingTitle: "Starting investigation…",
      errorTitle: "Failed to start investigation",
      missingRepository: "Connect a GitHub repository first",
      missingIntegration: "Connect a GitHub integration first",
      signedOut: "Sign in to start an investigation",
      missingModel:
        "Couldn't resolve a default model. Open the task page once and pick a model, then try again.",
    },
    buildInput,
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="font-semibold text-[11px] text-gray-10 uppercase tracking-wide">
          Pull requests
        </span>
        {!repoPath && (
          <span className="text-gray-10 text-xs">
            Add a local folder for this repo to map this element to code and
            PRs.
          </span>
        )}
        {repoPath && !codeContext && needles.length > 0 && <Spinner />}
        {repoPath && needles.length === 0 && (
          <span className="text-gray-10 text-xs">
            This element has no stable key (data-attr, id, or text) to search
            the code for.
          </span>
        )}
        {codeContext && (
          <>
            {codeContext.openPrs.map((pr) => (
              <PrRow
                key={pr.url}
                label="open"
                title={`#${pr.number} ${pr.title}`}
                url={pr.url}
              />
            ))}
            {codeContext.mergedPrs.map((pr) => (
              <PrRow
                key={pr.url}
                label="merged"
                title={`#${pr.number} ${pr.title}`}
                url={pr.url}
              />
            ))}
            {codeContext.openPrs.length === 0 &&
              codeContext.mergedPrs.length === 0 && (
                <span className="text-gray-10 text-xs">
                  {codeContext.files.length === 0
                    ? "No source files reference this element's keys."
                    : "No recent PRs touched this element's source files."}
                </span>
              )}
            {!codeContext.openPrsAvailable && (
              <span className="text-gray-10 text-xs">
                Open-PR lookup unavailable (gh CLI) — merged history shown from
                git.
              </span>
            )}
            {codeContext.files.length > 0 && (
              <span className="truncate text-[11px] text-gray-10">
                Source: {codeContext.files.slice(0, 3).join(", ")}
                {codeContext.files.length > 3 &&
                  ` +${codeContext.files.length - 3} more`}
              </span>
            )}
          </>
        )}
      </div>
      <Button
        variant="primary"
        size="default"
        disabled={isRunning}
        onClick={() => void run()}
      >
        <MagnifyingGlassIcon size={14} />
        {isRunning ? "Starting…" : "Investigate"}
      </Button>
    </div>
  );
}

function PrRow(props: { label: string; title: string; url: string }) {
  return (
    <button
      type="button"
      className="flex items-center gap-2 rounded border border-gray-4 px-2 py-1.5 text-left text-xs hover:bg-gray-3"
      onClick={() => openExternalUrl(props.url)}
    >
      <GitPullRequestIcon
        size={12}
        className={
          props.label === "open"
            ? "shrink-0 text-green-10"
            : "shrink-0 text-purple-10"
        }
      />
      <span className="min-w-0 truncate text-gray-12">{props.title}</span>
      <span className="ml-auto shrink-0 text-gray-10">{props.label}</span>
    </button>
  );
}
