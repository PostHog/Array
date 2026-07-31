import { GlobeIcon, MonitorIcon, PlusIcon } from "@phosphor-icons/react";
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
} from "@posthog/quill";
import type { ProductEnvironment } from "@posthog/shared";
import { useState } from "react";
import {
  useProductUrlSuggestions,
  useSaveProductEnvironment,
} from "./useProductEnvironments";

function labelForSuggestion(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" ? "Local dev" : host;
  } catch {
    return url;
  }
}

function compactCount(value: number): string {
  return Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

/**
 * First-run (and add-environment) screen for the Product tab: pick where your
 * product lives. Suggestions come from the project's own PostHog data — its
 * toolbar app URLs and the hosts $pageview traffic reports — plus a manual
 * field for anything else (e.g. http://localhost:8010 from `hogli start`).
 */
export function ProductEnvironmentPicker(props: {
  projectId: number;
  onCreated: (environment: ProductEnvironment) => void;
}) {
  const { projectId, onCreated } = props;
  const { data: suggestions, isLoading } = useProductUrlSuggestions(true);
  const save = useSaveProductEnvironment();
  const [customUrl, setCustomUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = (url: string, label: string) => {
    setError(null);
    save.mutate(
      { projectId, label, pageOrigin: url, dataProjectId: projectId },
      {
        onSuccess: onCreated,
        onError: (e) => setError(e.message),
      },
    );
  };

  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GlobeIcon size={28} />
        </EmptyMedia>
        <EmptyTitle>Open your product</EmptyTitle>
        <EmptyDescription>
          Browse your live site — or a local checkout — with PostHog data
          overlaid on it. Pick where your product lives; analytics come from
          this project either way.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex w-full max-w-md flex-col gap-2">
          {isLoading && (
            <span className="text-center text-gray-11 text-sm">
              Looking at your project's traffic…
            </span>
          )}
          {(suggestions ?? []).map((s) => (
            <Button
              key={s.url}
              variant="outline"
              size="default"
              className="justify-between"
              disabled={save.isPending}
              onClick={() => create(s.url, labelForSuggestion(s.url))}
            >
              <span className="flex items-center gap-2">
                {s.url.includes("//localhost") ||
                s.url.includes("//127.0.0.1") ? (
                  <MonitorIcon size={14} />
                ) : (
                  <GlobeIcon size={14} />
                )}
                {s.url}
              </span>
              {s.eventCount !== undefined && (
                <span className="text-gray-11 text-xs">
                  {compactCount(s.eventCount)} views/7d
                </span>
              )}
            </Button>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (customUrl.trim()) {
                create(customUrl.trim(), labelForSuggestion(customUrl.trim()));
              }
            }}
          >
            <Input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://your-product.com or http://localhost:8010"
              aria-label="Product URL"
            />
            <Button
              type="submit"
              variant="primary"
              size="default"
              disabled={!customUrl.trim() || save.isPending}
            >
              <PlusIcon size={14} />
              Open
            </Button>
          </form>
          {error && <span className="text-red-11 text-sm">{error}</span>}
        </div>
      </EmptyContent>
    </Empty>
  );
}
