import { useSetupStore } from "@features/setup/stores/setupStore";
import { Rocket } from "@phosphor-icons/react";

interface SetupItemProps {
  isActive: boolean;
  onClick: () => void;
}

type ItemState = "running" | "ready" | "finish";

function selectItemState(
  status: "idle" | "running" | "done" | "error",
  taskCount: number,
): ItemState {
  if (status === "running") return "running";
  if (status === "done" && taskCount > 0) return "ready";
  return "finish";
}

const LABELS: Record<ItemState, string> = {
  running: "Scanning your code",
  ready: "Tasks ready",
  finish: "Finish setup",
};

export function SetupItem({ isActive, onClick }: SetupItemProps) {
  const state = useSetupStore((s) =>
    selectItemState(s.discoveryStatus, s.discoveredTasks.length),
  );

  return (
    <button
      type="button"
      className={`focus-visible:-outline-offset-2 flex w-full cursor-pointer items-start gap-1 rounded-lg px-2 py-1.5 text-left text-(--green-11) text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-8 ${
        isActive ? "bg-(--green-4)" : "bg-(--green-a3)"
      }`}
      data-active={isActive || undefined}
      onClick={onClick}
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-(--green-11)">
        <Rocket size={16} weight={isActive ? "fill" : "duotone"} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <span className="flex h-[18px] items-center gap-1">
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-(--green-11)">
            {LABELS[state]}
          </span>
          {state === "running" && (
            <span
              aria-hidden
              className="block h-[7px] w-[7px] shrink-0 animate-pulse rounded-full bg-(--green-9)"
            />
          )}
          {state === "ready" && (
            <span
              aria-hidden
              className="block h-[7px] w-[7px] shrink-0 rounded-full bg-(--green-9)"
            />
          )}
        </span>
      </span>
    </button>
  );
}
