import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CursorClickIcon,
  GlobeIcon,
  MonitorIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useHostTRPC } from "@posthog/host-router/react";
import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
} from "@posthog/quill";
import type { ProductEnvironment } from "@posthog/shared";
import { useProjects } from "@posthog/ui/features/projects/useProjects";
import { useHostCapabilities } from "@posthog/ui/shell/useHostCapabilities";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ElementDetailsPanel } from "./ElementDetailsPanel";
import { ProductEnvironmentPicker } from "./ProductEnvironmentPicker";
import { useProductViewObscuredStore } from "./productViewObscuredStore";
import {
  useProductEnvironments,
  useRemoveProductEnvironment,
} from "./useProductEnvironments";
import { useProductViewPageState, useProductViewSlot } from "./useProductView";
import { useSelectedElement } from "./useSelectedElement";

function isLocalOrigin(origin: string): boolean {
  return origin.includes("//localhost") || origin.includes("//127.0.0.1");
}

/**
 * The Product tab: a live embedded browser showing the user's product with
 * PostHog context around it. The page itself is painted by a host-owned
 * native view glued to the slot div; this component renders the chrome
 * (toolbar, environment switcher) and drives the view over tRPC.
 */
export function ProductView() {
  const capabilities = useHostCapabilities();
  const { currentProject, currentProjectId } = useProjects();
  const projectId =
    typeof currentProjectId === "number" ? currentProjectId : null;
  const { data: environments, isLoading } = useProductEnvironments(projectId);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const activeEnv = useMemo(() => {
    if (!environments?.length) return null;
    return environments.find((e) => e.id === activeEnvId) ?? environments[0];
  }, [environments, activeEnvId]);

  if (!capabilities.embeddedBrowser) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GlobeIcon size={28} />
          </EmptyMedia>
          <EmptyTitle>Product view isn't available here</EmptyTitle>
          <EmptyDescription>
            This host can't embed a live browser. Open PostHog Code on desktop
            to browse your product with data overlaid.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (projectId == null) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GlobeIcon size={28} />
          </EmptyMedia>
          <EmptyTitle>Sign in to open your product</EmptyTitle>
          <EmptyDescription>
            The Product tab browses your live site (or a local checkout) with
            your PostHog project's analytics overlaid on it. Connect your
            PostHog account to pick a project first.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (isLoading) return null;

  if (!activeEnv || adding) {
    return (
      <ProductEnvironmentPicker
        projectId={projectId}
        onCreated={(env) => {
          setActiveEnvId(env.id);
          setAdding(false);
        }}
      />
    );
  }

  return (
    <ProductBrowser
      key={activeEnv.id}
      environment={activeEnv}
      environments={environments ?? []}
      dataProjectName={currentProject?.name ?? `project ${projectId}`}
      onSwitchEnvironment={setActiveEnvId}
      onAddEnvironment={() => setAdding(true)}
    />
  );
}

function ProductBrowser(props: {
  environment: ProductEnvironment;
  environments: ProductEnvironment[];
  dataProjectName: string;
  onSwitchEnvironment: (id: string) => void;
  onAddEnvironment: () => void;
}) {
  const {
    environment,
    environments,
    dataProjectName,
    onSwitchEnvironment,
    onAddEnvironment,
  } = props;
  const trpc = useHostTRPC();
  const viewId = `product-${environment.id}`;
  const initialUrl = environment.currentUrl ?? environment.pageOrigin;

  const slotRef = useProductViewSlot({
    viewId,
    url: initialUrl,
    dataProjectId: environment.dataProjectId,
  });
  const pageState = useProductViewPageState(viewId);

  const navigate = useMutation(trpc.productView.navigate.mutationOptions());
  const goBack = useMutation(trpc.productView.goBack.mutationOptions());
  const goForward = useMutation(trpc.productView.goForward.mutationOptions());
  const reload = useMutation(trpc.productView.reload.mutationOptions());
  const touch = useMutation(
    trpc.productView.touchEnvironment.mutationOptions(),
  );
  const setInspectMode = useMutation(
    trpc.productView.setInspectMode.mutationOptions(),
  );
  const removeEnvironment = useRemoveProductEnvironment();

  const [inspecting, setInspecting] = useState(false);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const { selected, clear: clearSelected } = useSelectedElement(viewId);
  const currentUrl = pageState?.url || initialUrl;

  // Remember where this environment is parked (debounced) so the tab restores
  // to the same page next launch.
  const touchMutate = touch.mutate;
  useEffect(() => {
    if (!pageState?.url) return;
    const handle = setTimeout(() => {
      touchMutate({ id: environment.id, currentUrl: pageState.url });
    }, 1000);
    return () => clearTimeout(handle);
  }, [pageState?.url, environment.id, touchMutate]);

  const submitUrl = () => {
    if (draftUrl == null) return;
    let url = draftUrl.trim();
    if (url && !/^https?:\/\//.test(url)) url = `https://${url}`;
    setDraftUrl(null);
    if (url && url !== currentUrl) navigate.mutate({ viewId, url });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-gray-4 border-b px-2 py-1.5">
        <Button
          size="icon-sm"
          aria-label="Back"
          disabled={!pageState?.canGoBack}
          onClick={() => goBack.mutate({ viewId })}
        >
          <ArrowLeftIcon size={14} />
        </Button>
        <Button
          size="icon-sm"
          aria-label="Forward"
          disabled={!pageState?.canGoForward}
          onClick={() => goForward.mutate({ viewId })}
        >
          <ArrowRightIcon size={14} />
        </Button>
        <Button
          size="icon-sm"
          aria-label="Reload"
          onClick={() => reload.mutate({ viewId })}
        >
          <ArrowClockwiseIcon size={14} />
        </Button>
        <Input
          className="h-7 flex-1 font-mono text-xs"
          value={draftUrl ?? currentUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => setDraftUrl(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitUrl();
            if (e.key === "Escape") setDraftUrl(null);
          }}
          aria-label="Page URL"
          spellCheck={false}
        />
        <Button
          variant={inspecting ? "primary" : "outline"}
          size="sm"
          aria-pressed={inspecting}
          title="Inspect: hover to see element analytics, click to select"
          onClick={() => {
            const next = !inspecting;
            setInspecting(next);
            setInspectMode.mutate({ viewId, enabled: next });
          }}
        >
          <CursorClickIcon size={14} />
          Inspect
        </Button>
        {/* One pill per environment: a click switches instantly (each
            environment keeps its own live view). Inline — a popover here
            would be hidden under the native page view. */}
        {environments.map((env) => (
          <EnvironmentPill
            key={env.id}
            environment={env}
            active={env.id === environment.id}
            onSelect={() => onSwitchEnvironment(env.id)}
            onRemove={() => removeEnvironment.mutate({ id: env.id })}
          />
        ))}
        <Button
          size="icon-sm"
          aria-label="Add environment"
          title="Add environment"
          onClick={onAddEnvironment}
        >
          <PlusIcon size={14} />
        </Button>
        <Badge
          variant="default"
          title="Analytics overlaid on this page come from this PostHog project"
        >
          Data: {dataProjectName}
        </Badge>
      </div>
      <div className="flex min-h-0 flex-1 flex-row">
        {/* The native browser view is glued to this slot's rect by the host. */}
        <div ref={slotRef} className="min-h-0 min-w-0 flex-1 bg-gray-2" />
        {selected && (
          <ElementDetailsPanel
            viewId={viewId}
            selected={selected}
            dataProjectId={environment.dataProjectId}
            environmentLabel={environment.label}
            onClose={clearSelected}
          />
        )}
      </div>
    </div>
  );
}

/** Toolbar pill for one environment. Right-click for management actions;
 * the context menu hides the native view while open (z-order). */
function EnvironmentPill(props: {
  environment: ProductEnvironment;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { environment, active, onSelect, onRemove } = props;
  const acquire = useProductViewObscuredStore((s) => s.acquire);
  const release = useProductViewObscuredStore((s) => s.release);
  // Balance the counter if the pill unmounts while its menu is open (e.g.
  // "Remove environment" removes the pill itself) — a leaked acquire would
  // keep the page hidden forever.
  const holdingRef = useRef(false);
  useEffect(
    () => () => {
      if (holdingRef.current) release();
    },
    [release],
  );
  return (
    <ContextMenu
      onOpenChange={(open) => {
        holdingRef.current = open;
        if (open) acquire();
        else release();
      }}
    >
      <ContextMenuTrigger
        render={
          <Button
            variant={active ? "primary" : "outline"}
            size="sm"
            title={environment.pageOrigin}
            onClick={onSelect}
          >
            {isLocalOrigin(environment.pageOrigin) ? (
              <MonitorIcon size={14} />
            ) : (
              <GlobeIcon size={14} />
            )}
            {environment.label}
          </Button>
        }
      />
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onClick={onRemove}>
          <TrashIcon size={14} />
          Remove environment
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
