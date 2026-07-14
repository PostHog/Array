import type { NotebookKernelStatus } from "@posthog/api-client/posthog-client";
import { Badge, Button } from "@posthog/quill";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { Loader2, RefreshCw } from "lucide-react";
import type { JSX } from "react";
import { useState } from "react";
import { useKernelStatus } from "./useKernelStatus";

// Allowed compute-profile values (validated server-side on kernel/config).
const CPU_CORE_OPTIONS = [0.125, 0.25, 0.5, 1, 2, 4, 6, 8, 16, 32, 64];
const MEMORY_GB_OPTIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256];
const IDLE_TIMEOUT_OPTIONS: { value: number; label: string }[] = [
  { value: 600, label: "10 minutes" },
  { value: 1800, label: "30 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 10800, label: "3 hours" },
  { value: 21600, label: "6 hours" },
  { value: 43200, label: "12 hours" },
];

// Modal pricing (same figures the PostHog webapp shows).
const CPU_PRICE_PER_CORE_HOUR = 0.1419;
const MEMORY_PRICE_PER_GIB_HOUR = 0.0242;

type BadgeVariant = "default" | "success" | "info" | "warning" | "destructive";

const STATUS_BADGES: Record<string, { label: string; variant: BadgeVariant }> =
  {
    running: { label: "Running", variant: "success" },
    starting: { label: "Starting", variant: "info" },
    stopped: { label: "Stopped", variant: "default" },
    timed_out: { label: "Timed out", variant: "warning" },
    discarded: { label: "Discarded", variant: "warning" },
    error: { label: "Error", variant: "destructive" },
  };

function formatCores(value: number): string {
  const formatted =
    value % 1 === 0
      ? value.toString()
      : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${formatted}x`;
}

function formatMemory(value: number): string {
  return value < 1 ? `${Math.round(value * 1024)} MB` : `${value} GB`;
}

export interface KernelPanelProps {
  /** The notebook's short id. */
  shortId: string;
}

/**
 * Kernel panel for a notebook (the webapp's NotebookKernelInfo equivalent):
 * status + backend badges, CPU/RAM/idle-timeout controls (modal backend
 * only), Start/Restart, Stop and Refresh. Polls the status while mounted —
 * every 2s while starting, every 10s otherwise.
 */
export function KernelPanel({ shortId }: KernelPanelProps): JSX.Element {
  const client = useOptionalAuthenticatedClient();
  const { status, loading, error, refresh, applyStatus, hasClient } =
    useKernelStatus(shortId);
  const [action, setAction] = useState<
    "start" | "restart" | "stop" | "refresh" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Compute-profile drafts; null = follow the kernel's reported value.
  const [cpuDraft, setCpuDraft] = useState<number | null>(null);
  const [memoryDraft, setMemoryDraft] = useState<number | null>(null);
  const [idleDraft, setIdleDraft] = useState<number | null>(null);

  const isModal = status?.backend === "modal";
  const isRunning = status?.status === "running";
  const isStarting = status?.status === "starting";
  const selectedCpu = cpuDraft ?? status?.cpu_cores ?? 1;
  const selectedMemory = memoryDraft ?? status?.memory_gb ?? 2;
  const selectedIdle = idleDraft ?? status?.idle_timeout_seconds ?? 1800;
  const hasConfigChanges =
    (cpuDraft !== null && cpuDraft !== status?.cpu_cores) ||
    (memoryDraft !== null && memoryDraft !== status?.memory_gb) ||
    (idleDraft !== null && idleDraft !== status?.idle_timeout_seconds);

  const runAction = async (
    kind: "start" | "restart" | "stop" | "refresh",
  ): Promise<void> => {
    if (!client || action) return;
    setAction(kind);
    setActionError(null);
    try {
      if (kind === "refresh") {
        await refresh();
        return;
      }
      if (kind === "stop") {
        await client.notebookKernelStop(shortId);
      } else {
        // Persist a changed compute profile first — it applies on start/restart.
        if (isModal && hasConfigChanges) {
          await client.notebookKernelConfig(shortId, {
            cpu_cores: selectedCpu,
            memory_gb: selectedMemory,
            idle_timeout_seconds: selectedIdle,
          });
          setCpuDraft(null);
          setMemoryDraft(null);
          setIdleDraft(null);
        }
        const result =
          kind === "restart"
            ? await client.notebookKernelRestart(shortId)
            : await client.notebookKernelStart(shortId);
        applyStatus({
          ...(status ?? { backend: null, status: null }),
          status: result.status,
        } as NotebookKernelStatus);
      }
      await refresh();
    } catch (runError) {
      setActionError(
        runError instanceof Error ? runError.message : "Kernel action failed",
      );
    } finally {
      setAction(null);
    }
  };

  const badge = status?.status ? STATUS_BADGES[status.status] : null;
  const hourlyPrice =
    selectedCpu * CPU_PRICE_PER_CORE_HOUR +
    selectedMemory * MEMORY_PRICE_PER_GIB_HOUR;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-(--gray-4) p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-(--gray-12) text-sm">
          Kernel
        </span>
        <Button
          variant="outline"
          size="icon-xs"
          aria-label="Refresh kernel status"
          disabled={action !== null || !hasClient}
          onClick={() => void runAction("refresh")}
        >
          {action === "refresh" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
        </Button>
      </div>

      {!hasClient ? (
        <div className="text-(--gray-9) text-xs">
          Sign in to PostHog to manage the kernel.
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-(--gray-9) text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          Loading kernel status…
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {badge ? (
              <Badge variant={badge.variant}>{badge.label}</Badge>
            ) : (
              <Badge variant="default">No kernel</Badge>
            )}
            {status?.backend ? (
              <Badge variant="default">
                {status.backend === "modal" ? "Modal" : "Local – Docker"}
              </Badge>
            ) : null}
            {isModal ? (
              <span className="ml-auto font-medium text-(--gray-11) text-xs">
                ${hourlyPrice.toFixed(2)} / h
              </span>
            ) : null}
          </div>

          {error ? (
            <div className="break-words text-(--red-11) text-xs">{error}</div>
          ) : null}
          {status?.last_error ? (
            <div className="break-words text-(--red-11) text-xs">
              Error: {status.last_error}
            </div>
          ) : null}

          {isModal ? (
            <div className="flex flex-col gap-2">
              <ConfigSelect
                label="CPU"
                value={selectedCpu}
                options={CPU_CORE_OPTIONS.map((value) => ({
                  value,
                  label: formatCores(value),
                }))}
                onChange={setCpuDraft}
              />
              <ConfigSelect
                label="RAM"
                value={selectedMemory}
                options={MEMORY_GB_OPTIONS.map((value) => ({
                  value,
                  label: formatMemory(value),
                }))}
                onChange={setMemoryDraft}
              />
              <ConfigSelect
                label="Idle timeout"
                value={selectedIdle}
                options={IDLE_TIMEOUT_OPTIONS}
                onChange={setIdleDraft}
              />
              {hasConfigChanges ? (
                <div className="text-(--gray-9) text-xs">
                  Changes apply on the next start or restart.
                </div>
              ) : null}
            </div>
          ) : status?.backend === "docker" ? (
            <div className="text-(--gray-9) text-xs">
              Using the docker-based local kernel. Can't update the compute
              profile.
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="xs"
              disabled={action !== null || isStarting}
              onClick={() => void runAction(isRunning ? "restart" : "start")}
            >
              {action === "start" || action === "restart" || isStarting ? (
                <Loader2 className="animate-spin" />
              ) : null}
              {isRunning ? "Restart" : "Start"}
            </Button>
            <Button
              variant="outline"
              size="xs"
              disabled={action !== null || !isRunning}
              title={isRunning ? undefined : "Kernel is not running"}
              onClick={() => void runAction("stop")}
            >
              {action === "stop" ? <Loader2 className="animate-spin" /> : null}
              Stop
            </Button>
          </div>
          {actionError ? (
            <div className="break-words text-(--red-11) text-xs">
              {actionError}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function ConfigSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: { value: number; label: string }[];
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="shrink-0 text-(--gray-9)">{label}</span>
      <select
        aria-label={label}
        className="rounded border border-(--gray-5) bg-transparent px-1 py-0.5 text-xs"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
